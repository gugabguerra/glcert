package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/glcert/glcert/internal/models"
	"github.com/glcert/glcert/internal/services"
	"github.com/google/uuid"
)

type CAHandler struct {
	db    *sql.DB
	ca    *services.CAService
	crypto *services.CryptoService
}

func NewCAHandler(db *sql.DB, ca *services.CAService, crypto *services.CryptoService) *CAHandler {
	return &CAHandler{db: db, ca: ca, crypto: crypto}
}

func (h *CAHandler) getPassphrase(caID string) string {
	var encPassphrase []byte
	err := h.db.QueryRow("SELECT key_encrypted_passphrase FROM certificate_authorities WHERE id = ?", caID).Scan(&encPassphrase)
	if err != nil || len(encPassphrase) == 0 {
		return ""
	}
	decrypted, err := h.crypto.Decrypt(encPassphrase)
	if err != nil {
		return ""
	}
	return string(decrypted)
}

type CreateCARequest struct {
	Name         string `json:"name"`
	Description  string `json:"description"`
	CommonName   string `json:"commonName"`
	Organization string `json:"organization"`
	Country      string `json:"country"`
	State        string `json:"state"`
	City         string `json:"city"`
	Email        string `json:"email"`
	KeyAlgorithm string `json:"keyAlgorithm"`
	RSAKeySize   int    `json:"rsaKeySize"`
	ValidityDays int    `json:"validityDays"`
	Passphrase   string `json:"passphrase"`
}

type ImportCARequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	CertPEM     string `json:"certPem"`
	KeyPEM      string `json:"keyPem"`
	Passphrase  string `json:"passphrase"`
}

func (h *CAHandler) List(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Query(`
		SELECT id, name, description, subject, created_at, expires_at, current_version,
			COALESCE(key_encrypted_passphrase, X''), COALESCE(imported, FALSE)
		FROM certificate_authorities ORDER BY created_at DESC
	`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type CAResponse struct {
		ID             string `json:"id"`
		Name           string `json:"name"`
		Description    string `json:"description"`
		Subject        string `json:"subject"`
		CreatedAt      string `json:"createdAt"`
		ExpiresAt      string `json:"expiresAt"`
		CurrentVersion int    `json:"currentVersion"`
		HasPassphrase  bool   `json:"hasPassphrase"`
		Imported       bool   `json:"imported"`
	}

	var cas []CAResponse
	for rows.Next() {
		var ca CAResponse
		var encPassphrase []byte
		if err := rows.Scan(&ca.ID, &ca.Name, &ca.Description, &ca.Subject, &ca.CreatedAt, &ca.ExpiresAt, &ca.CurrentVersion, &encPassphrase, &ca.Imported); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		ca.HasPassphrase = len(encPassphrase) > 0
		cas = append(cas, ca)
	}

	if cas == nil {
		cas = []CAResponse{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(cas)
}

func (h *CAHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var ca models.CertificateAuthority
	var encPassphrase []byte
	var imported bool
	err := h.db.QueryRow(`
		SELECT id, name, description, subject, created_at, expires_at, current_version,
			COALESCE(key_encrypted_passphrase, X''), COALESCE(imported, FALSE)
		FROM certificate_authorities WHERE id = ?
	`, id).Scan(&ca.ID, &ca.Name, &ca.Description, &ca.Subject, &ca.CreatedAt, &ca.ExpiresAt, &ca.CurrentVersion, &encPassphrase, &imported)
	if err == sql.ErrNoRows {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	type CAResponse struct {
		ID               string `json:"id"`
		Name             string `json:"name"`
		Description      string `json:"description"`
		Subject          string `json:"subject"`
		CreatedAt        string `json:"createdAt"`
		ExpiresAt        string `json:"expiresAt"`
		CurrentVersion   int    `json:"currentVersion"`
		HasPassphrase    bool   `json:"hasPassphrase"`
		Imported         bool   `json:"imported"`
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(CAResponse{
		ID:             ca.ID,
		Name:           ca.Name,
		Description:    ca.Description,
		Subject:        ca.Subject,
		CreatedAt:      ca.CreatedAt.Format("2006-01-02T15:04:05Z"),
		ExpiresAt:      ca.ExpiresAt.Format("2006-01-02T15:04:05Z"),
		CurrentVersion: ca.CurrentVersion,
		HasPassphrase:  len(encPassphrase) > 0,
		Imported:       imported,
	})
}

func (h *CAHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req CreateCARequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if req.Name == "" || req.CommonName == "" {
		http.Error(w, "name and commonName are required", http.StatusBadRequest)
		return
	}

	caModel, certPEM, keyPEM, err := h.ca.GenerateCA(services.CreateCAInput{
		Name:         req.Name,
		Description:  req.Description,
		CommonName:   req.CommonName,
		Organization: req.Organization,
		Country:      req.Country,
		State:        req.State,
		City:         req.City,
		Email:        req.Email,
		KeyAlgorithm: req.KeyAlgorithm,
		RSAKeySize:   req.RSAKeySize,
		ValidityDays: req.ValidityDays,
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if req.Passphrase != "" {
		keyPEM, err = services.EncryptPEMWithPassphrase(keyPEM, req.Passphrase)
		if err != nil {
			http.Error(w, "failed to encrypt key with passphrase: "+err.Error(), http.StatusInternalServerError)
			return
		}
	}

	if err := h.ca.SaveCA(req.Name, 1, certPEM, keyPEM); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	id := uuid.New().String()

	var encPassphrase interface{}
	if req.Passphrase != "" {
		encrypted, err := h.crypto.Encrypt([]byte(req.Passphrase))
		if err != nil {
			http.Error(w, "failed to encrypt passphrase", http.StatusInternalServerError)
			return
		}
		encPassphrase = encrypted
	}

	_, err = h.db.Exec(`
		INSERT INTO certificate_authorities (id, name, description, subject, expires_at, current_version, key_encrypted_passphrase)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, id, caModel.Name, caModel.Description, caModel.Subject, caModel.ExpiresAt, 1, encPassphrase)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	caModel.ID = id

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(caModel)
}

func (h *CAHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var name string
	err := h.db.QueryRow("SELECT name FROM certificate_authorities WHERE id = ?", id).Scan(&name)
	if err == sql.ErrNoRows {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if _, err := h.db.Exec("DELETE FROM certificate_authorities WHERE id = ?", id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	h.ca.DeleteCA(name)

	w.WriteHeader(http.StatusNoContent)
}

func (h *CAHandler) DownloadCert(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var name string
	var version int
	err := h.db.QueryRow("SELECT name, current_version FROM certificate_authorities WHERE id = ?", id).Scan(&name, &version)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	passphrase := h.getPassphrase(id)

	certPEM, _, err := h.ca.ReadCA(name, version, passphrase)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/x-pem-file")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s-ca.crt\"", name))
	w.Write(certPEM)
}

func (h *CAHandler) DownloadKey(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var name string
	var version int
	err := h.db.QueryRow("SELECT name, current_version FROM certificate_authorities WHERE id = ?", id).Scan(&name, &version)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	passphrase := h.getPassphrase(id)

	_, keyPEM, err := h.ca.ReadCA(name, version, passphrase)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/x-pem-file")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s-ca.key\"", name))
	w.Write(keyPEM)
}

func (h *CAHandler) DownloadCABundle(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	format := r.URL.Query().Get("format")
	if format != "tgz" {
		format = "zip"
	}

	var name, description string
	var version int
	err := h.db.QueryRow("SELECT name, description, current_version FROM certificate_authorities WHERE id = ?", id).Scan(&name, &description, &version)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	passphrase := h.getPassphrase(id)

	certPEM, keyPEM, err := h.ca.ReadCA(name, version, passphrase)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	files := []BundleFile{
		{Name: "ca.crt", Content: certPEM},
		{Name: "ca.key", Content: keyPEM},
	}

	readmeContent := fmt.Sprintf("GLCert CA Bundle\n"+
		"================\n\n"+
		"Name: %s\n"+
		"Description: %s\n"+
		"Version: %d\n\n"+
		"Files:\n"+
		"  ca.crt - CA Certificate\n"+
		"  ca.key - CA Private Key\n",
		name, description, version)
	files = append(files, BundleFile{Name: "README.txt", Content: []byte(readmeContent)})

	w.Header().Set("Content-Type", BundleContentType(format))
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s%s\"", name, BundleExtension(format)))
	WriteBundle(w, files, format)
}

func (h *CAHandler) Import(w http.ResponseWriter, r *http.Request) {
	var req ImportCARequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if req.Name == "" || req.CertPEM == "" {
		http.Error(w, "name and certPem are required", http.StatusBadRequest)
		return
	}

	caModel, err := h.ca.ImportCA(req.Name, req.Description, []byte(req.CertPEM), []byte(req.KeyPEM), req.Passphrase)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if err := h.ca.SaveCA(req.Name, 1, []byte(req.CertPEM), []byte(req.KeyPEM)); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	id := uuid.New().String()

	var encPassphrase interface{}
	if req.Passphrase != "" {
		encrypted, err := h.crypto.Encrypt([]byte(req.Passphrase))
		if err != nil {
			http.Error(w, "failed to encrypt passphrase", http.StatusInternalServerError)
			return
		}
		encPassphrase = encrypted
	}

	_, err = h.db.Exec(`
		INSERT INTO certificate_authorities (id, name, description, subject, expires_at, current_version, key_encrypted_passphrase, imported)
		VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)
	`, id, caModel.Name, caModel.Description, caModel.Subject, caModel.ExpiresAt, 1, encPassphrase)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	caModel.ID = id

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(caModel)
}
