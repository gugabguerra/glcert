package handlers

import (
	"archive/zip"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
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

func (h *ShareHandler) GenerateLink(w http.ResponseWriter, r *http.Request) {
	entityType := chi.URLParam(r, "type")
	entityID := chi.URLParam(r, "id")

	if entityType != "certificate" && entityType != "ca" {
		http.Error(w, "invalid entity type", http.StatusBadRequest)
		return
	}

	token, err := generateToken()
	if err != nil {
		http.Error(w, "failed to generate token", http.StatusInternalServerError)
		return
	}

	expiresAt := time.Now().Add(15 * time.Minute)

	_, err = h.db.Exec(
		"INSERT INTO share_links (token, entity_type, entity_id, expires_at) VALUES (?, ?, ?, ?)",
		token, entityType, entityID, expiresAt.Format(time.RFC3339),
	)
	if err != nil {
		http.Error(w, "failed to create share link", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	fmt.Fprintf(w, `{"token":"%s","expires_at":"%s"}`, token, expiresAt.Format(time.RFC3339))
}

func (h *ShareHandler) ServeLink(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")

	var entityType string
	var entityID int
	var expiresAt time.Time

	err := h.db.QueryRow(
		"SELECT entity_type, entity_id, expires_at FROM share_links WHERE token = ?", token,
	).Scan(&entityType, &entityID, &expiresAt)

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
		h.serveCertBundle(w, int64(entityID))
	} else {
		h.serveCABundle(w, int64(entityID))
	}

	go h.db.Exec("DELETE FROM share_links WHERE token = ?", token)
}

func (h *ShareHandler) serveCertBundle(w http.ResponseWriter, id int64) {
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

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s.zip\"", name))

	zipWriter := zip.NewWriter(w)
	defer zipWriter.Close()

	fw, _ := zipWriter.Create("cert.pem")
	fw.Write(certPEM)

	fw, _ = zipWriter.Create("key.pem")
	fw.Write(keyPEM)

	if caPEM != nil {
		fw, _ = zipWriter.Create("ca.pem")
		fw.Write(caPEM)
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
	fw, _ = zipWriter.Create("README.txt")
	fw.Write([]byte(readmeContent))
}

func (h *ShareHandler) serveCABundle(w http.ResponseWriter, id int64) {
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

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s.zip\"", name))

	zipWriter := zip.NewWriter(w)
	defer zipWriter.Close()

	fw, _ := zipWriter.Create("ca.crt")
	fw.Write(certPEM)

	fw, _ = zipWriter.Create("ca.key")
	fw.Write(keyPEM)

	readmeContent := fmt.Sprintf("GLCert CA Bundle\n"+
		"================\n\n"+
		"Name: %s\n"+
		"Description: %s\n"+
		"Version: %d\n\n"+
		"Files:\n"+
		"  ca.crt - CA Certificate\n"+
		"  ca.key - CA Private Key\n",
		name, description, version)
	fw, _ = zipWriter.Create("README.txt")
	fw.Write([]byte(readmeContent))
}

func generateToken() (string, error) {
	b := make([]byte, 16)
	_, err := rand.Read(b)
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
