package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/gugabguerra/glcert/internal/logger"
	"github.com/gugabguerra/glcert/internal/models"
	"github.com/gugabguerra/glcert/internal/services"
)

type CAHandler struct {
	db     *sql.DB
	ca     *services.CAService
	crypto *services.CryptoService
	auth   *services.AuthService
}

func NewCAHandler(db *sql.DB, ca *services.CAService, crypto *services.CryptoService, auth *services.AuthService) *CAHandler {
	return &CAHandler{db: db, ca: ca, crypto: crypto, auth: auth}
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
	Name         string  `json:"name"`
	Description  string  `json:"description"`
	CommonName   string  `json:"commonName"`
	Organization string  `json:"organization"`
	Country      string  `json:"country"`
	State        string  `json:"state"`
	City         string  `json:"city"`
	Email        string  `json:"email"`
	KeyAlgorithm string  `json:"keyAlgorithm"`
	RSAKeySize   int     `json:"rsaKeySize"`
	ValidityDays int     `json:"validityDays"`
	Passphrase   string  `json:"passphrase"`
	ParentCAID   *string `json:"parentCaId"`
}

type ImportCARequest struct {
	Name        string  `json:"name"`
	Description string  `json:"description"`
	CertPEM     string  `json:"certPem"`
	KeyPEM      string  `json:"keyPem"`
	Passphrase  string  `json:"passphrase"`
	ParentCAID  *string `json:"parentCaId"`
}

func (h *CAHandler) List(w http.ResponseWriter, r *http.Request) {
	type CAResponse struct {
		ID             string  `json:"id"`
		Name           string  `json:"name"`
		Description    string  `json:"description"`
		Subject        string  `json:"subject"`
		CreatedAt      string  `json:"createdAt"`
		ExpiresAt      string  `json:"expiresAt"`
		CurrentVersion int     `json:"currentVersion"`
		HasPassphrase  bool    `json:"hasPassphrase"`
		Imported       bool    `json:"imported"`
		ParentCAID     *string `json:"parentCaId"`
	}

	userID := GetUserID(r.Context())
	query := `
		SELECT id, name, description, subject, created_at, expires_at, current_version,
			COALESCE(key_encrypted_passphrase, X''), COALESCE(imported, FALSE),
			COALESCE(parent_ca_id, '')
		FROM certificate_authorities
	`
	var args []interface{}

	// Filter by permissions for non-admins
	if userID != "" {
		accessibleIDs, err := h.auth.GetAccessibleCAIDs(userID)
		if err == nil && accessibleIDs != nil {
			if len(accessibleIDs) == 0 {
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode([]CAResponse{})
				return
			}
			placeholders := ""
			for i, id := range accessibleIDs {
				if i > 0 {
					placeholders += ", "
				}
				placeholders += "?"
				args = append(args, id)
			}
			query += " WHERE id IN (" + placeholders + ")"
		}
	}
	query += " ORDER BY created_at DESC"

	rows, err := h.db.Query(query, args...)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var cas []CAResponse
	for rows.Next() {
		var ca CAResponse
		var encPassphrase []byte
		var parentID string
		if err := rows.Scan(&ca.ID, &ca.Name, &ca.Description, &ca.Subject, &ca.CreatedAt, &ca.ExpiresAt, &ca.CurrentVersion, &encPassphrase, &ca.Imported, &parentID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		ca.HasPassphrase = len(encPassphrase) > 0
		if parentID != "" {
			ca.ParentCAID = &parentID
		}
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
	var parentID sql.NullString
	err := h.db.QueryRow(`
		SELECT id, name, description, subject, created_at, expires_at, current_version,
			COALESCE(key_encrypted_passphrase, X''), COALESCE(imported, FALSE),
			parent_ca_id
		FROM certificate_authorities WHERE id = ?
	`, id).Scan(&ca.ID, &ca.Name, &ca.Description, &ca.Subject, &ca.CreatedAt, &ca.ExpiresAt, &ca.CurrentVersion, &encPassphrase, &imported, &parentID)
	if err == sql.ErrNoRows {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	type CAResponse struct {
		ID             string  `json:"id"`
		Name           string  `json:"name"`
		Description    string  `json:"description"`
		Subject        string  `json:"subject"`
		CreatedAt      string  `json:"createdAt"`
		ExpiresAt      string  `json:"expiresAt"`
		CurrentVersion int     `json:"currentVersion"`
		HasPassphrase  bool    `json:"hasPassphrase"`
		Imported       bool    `json:"imported"`
		ParentCAID     *string `json:"parentCaId"`
		ParentCAName   *string `json:"parentCaName"`
	}

	resp := CAResponse{
		ID:             ca.ID,
		Name:           ca.Name,
		Description:    ca.Description,
		Subject:        ca.Subject,
		CreatedAt:      ca.CreatedAt.Format("2006-01-02T15:04:05Z"),
		ExpiresAt:      ca.ExpiresAt.Format("2006-01-02T15:04:05Z"),
		CurrentVersion: ca.CurrentVersion,
		HasPassphrase:  len(encPassphrase) > 0,
		Imported:       imported,
	}

	if parentID.Valid && parentID.String != "" {
		resp.ParentCAID = &parentID.String
		var parentName string
		if err := h.db.QueryRow("SELECT name FROM certificate_authorities WHERE id = ?", parentID.String).Scan(&parentName); err == nil {
			resp.ParentCAName = &parentName
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
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

	if err := validateEntityName(req.Name); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// If creating an intermediate CA, fetch parent CA cert and key
	var parentCertPEM, parentKeyPEM []byte
	if req.ParentCAID != nil && *req.ParentCAID != "" {
		var parentName string
		var parentVersion int
		var parentEncPassphrase []byte
		err := h.db.QueryRow(`
			SELECT name, current_version, COALESCE(key_encrypted_passphrase, X'')
			FROM certificate_authorities WHERE id = ?
		`, *req.ParentCAID).Scan(&parentName, &parentVersion, &parentEncPassphrase)
		if err != nil {
			http.Error(w, "parent CA not found", http.StatusBadRequest)
			return
		}

		var parentPassphrase string
		if len(parentEncPassphrase) > 0 {
			decrypted, dErr := h.crypto.Decrypt(parentEncPassphrase)
			if dErr == nil {
				parentPassphrase = string(decrypted)
			}
		}

		parentCertPEM, parentKeyPEM, err = h.ca.ReadCA(parentName, parentVersion, parentPassphrase)
		if err != nil {
			http.Error(w, "failed to read parent CA: "+err.Error(), http.StatusInternalServerError)
			return
		}
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
		ParentCAID:   req.ParentCAID,
	}, parentCertPEM, parentKeyPEM)
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
		INSERT INTO certificate_authorities (id, name, description, subject, expires_at, current_version, key_encrypted_passphrase, parent_ca_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, id, caModel.Name, caModel.Description, caModel.Subject, caModel.ExpiresAt, 1, encPassphrase, req.ParentCAID)
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

	// Orphan child CAs by clearing their parent reference
	h.db.Exec("UPDATE certificate_authorities SET parent_ca_id = NULL WHERE parent_ca_id = ?", id)

	// Cascade: remove CA permissions for this CA
	h.db.Exec("DELETE FROM ca_permissions WHERE ca_id = ?", id)

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
	if err := WriteBundle(w, files, format); err != nil {
		logger.Errorf("Failed to write CA bundle stream: %v", err)
	}
}

func (h *CAHandler) Import(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)

	var req ImportCARequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if req.Name == "" || req.CertPEM == "" || req.KeyPEM == "" {
		http.Error(w, "name, certPem, and keyPem are required", http.StatusBadRequest)
		return
	}

	if err := validateEntityName(req.Name); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
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
		INSERT INTO certificate_authorities (id, name, description, subject, expires_at, current_version, key_encrypted_passphrase, imported, parent_ca_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, TRUE, ?)
	`, id, caModel.Name, caModel.Description, caModel.Subject, caModel.ExpiresAt, 1, encPassphrase, req.ParentCAID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	caModel.ID = id

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(caModel)
}
