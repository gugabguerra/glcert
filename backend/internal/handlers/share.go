package handlers

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/glcert/glcert/internal/services"
)

type ShareHandler struct {
	db   *sql.DB
	cert *services.CertService
	ca   *services.CAService
}

func NewShareHandler(db *sql.DB, cert *services.CertService, ca *services.CAService) *ShareHandler {
	return &ShareHandler{db: db, cert: cert, ca: ca}
}

var validFileTypes = map[string]bool{
	"certificate": true,
	"key":         true,
	"ca":          true,
	"bundle_zip":  true,
	"bundle_tgz":  true,
}

func (h *ShareHandler) GenerateLink(w http.ResponseWriter, r *http.Request) {
	entityType := chi.URLParam(r, "type")
	entityID := chi.URLParam(r, "id")

	if entityType != "certificate" && entityType != "ca" {
		http.Error(w, "invalid entity type", http.StatusBadRequest)
		return
	}

	var req struct {
		FileType string `json:"fileType"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		req.FileType = ""
	}

	fileType := req.FileType
	if entityType == "ca" {
		switch fileType {
		case "certificate", "key":
		case "bundle_zip", "bundle_tgz":
		default:
			fileType = "bundle_zip"
		}
	} else {
		switch fileType {
		case "certificate", "key", "ca":
		case "bundle_zip", "bundle_tgz":
		default:
			fileType = "bundle_zip"
		}
	}

	token, err := generateToken()
	if err != nil {
		http.Error(w, "failed to generate token", http.StatusInternalServerError)
		return
	}

	expiresAt := time.Now().Add(15 * time.Minute)

	_, err = h.db.Exec(
		"INSERT INTO share_links (token, entity_type, entity_id, file_type, expires_at) VALUES (?, ?, ?, ?, ?)",
		token, entityType, entityID, fileType, expiresAt.Format(time.RFC3339),
	)
	if err != nil {
		http.Error(w, "failed to create share link", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	fmt.Fprintf(w, `{"token":"%s","expires_at":"%s","file_type":"%s"}`, token, expiresAt.Format(time.RFC3339), fileType)
}

func (h *ShareHandler) ServeLink(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")

	var entityType string
	var entityID string
	var fileType string
	var expiresAt time.Time

	err := h.db.QueryRow(
		"SELECT entity_type, entity_id, file_type, expires_at FROM share_links WHERE token = ?", token,
	).Scan(&entityType, &entityID, &fileType, &expiresAt)

	if err == sql.ErrNoRows {
		http.Error(w, "link not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	if time.Now().After(expiresAt) {
		http.Error(w, "link expired", http.StatusGone)
		return
	}

	if entityType == "certificate" {
		h.serveCertFile(w, r, entityID, fileType)
	} else {
		h.serveCAFile(w, r, entityID, fileType)
	}

	go h.db.Exec("DELETE FROM share_links WHERE token = ?", token)
}

func (h *ShareHandler) serveCertFile(w http.ResponseWriter, r *http.Request, id string, fileType string) {
	var name, certType, description string
	var version int
	err := h.db.QueryRow("SELECT name, type, description, current_version FROM certificates WHERE id = ?", id).Scan(&name, &certType, &description, &version)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	certPEM, keyPEM, caPEM, err := h.cert.ReadCert(certType, name, version)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	switch fileType {
	case "certificate":
		w.Header().Set("Content-Type", "application/x-pem-file")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s-cert.pem\"", name))
		w.Write(certPEM)
	case "key":
		w.Header().Set("Content-Type", "application/x-pem-file")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s-key.pem\"", name))
		w.Write(keyPEM)
	case "ca":
		if caPEM == nil {
			http.Error(w, "no CA certificate", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/x-pem-file")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s-ca.pem\"", name))
		w.Write(caPEM)
	case "bundle_zip", "bundle_tgz":
		format := "zip"
		if fileType == "bundle_tgz" {
			format = "tgz"
		}
		files := []BundleFile{
			{Name: "cert.pem", Content: certPEM},
			{Name: "key.pem", Content: keyPEM},
		}
		if caPEM != nil {
			files = append(files, BundleFile{Name: "ca.pem", Content: caPEM})
		}
		readmeContent := fmt.Sprintf("GLCert Certificate Bundle\n"+
			"========================\n\n"+
			"Name: %s\n"+
			"Type: %s\n"+
			"Description: %s\n"+
			"Version: %d\n\n"+
			"Files:\n"+
			"  cert.pem  - Certificate\n"+
			"  key.pem   - Private Key\n"+
			"  ca.pem    - CA Certificate (if applicable)\n",
			name, certType, description, version)
		files = append(files, BundleFile{Name: "README.txt", Content: []byte(readmeContent)})

		w.Header().Set("Content-Type", BundleContentType(format))
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s%s\"", name, BundleExtension(format)))
		WriteBundle(w, files, format)
	}
}

func (h *ShareHandler) serveCAFile(w http.ResponseWriter, r *http.Request, id string, fileType string) {
	var name, description string
	var version int
	err := h.db.QueryRow("SELECT name, description, current_version FROM certificate_authorities WHERE id = ?", id).Scan(&name, &description, &version)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	certPEM, keyPEM, err := h.ca.ReadCA(name, version)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	switch fileType {
	case "certificate":
		w.Header().Set("Content-Type", "application/x-pem-file")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s.crt\"", name))
		w.Write(certPEM)
	case "key":
		w.Header().Set("Content-Type", "application/x-pem-file")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s.key\"", name))
		w.Write(keyPEM)
	case "bundle_zip", "bundle_tgz":
		format := "zip"
		if fileType == "bundle_tgz" {
			format = "tgz"
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
}

func generateToken() (string, error) {
	b := make([]byte, 16)
	_, err := rand.Read(b)
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
