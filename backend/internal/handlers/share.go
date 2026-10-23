package handlers

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/gugabguerra/glcert/internal/logger"
	"github.com/gugabguerra/glcert/internal/services"
)

type ShareHandler struct {
	db     *sql.DB
	cert   *services.CertService
	ca     *services.CAService
	crypto *services.CryptoService
	email  *services.EmailService
	auth   *services.AuthService
	// publicURL is the configured origin emailed links are built from.
	publicURL string
}

func NewShareHandler(db *sql.DB, cert *services.CertService, ca *services.CAService, crypto *services.CryptoService, email *services.EmailService, auth *services.AuthService, publicURL string) *ShareHandler {
	return &ShareHandler{db: db, cert: cert, ca: ca, crypto: crypto, email: email, auth: auth, publicURL: publicURL}
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

	// Only allow sharing entities the caller is allowed to access.
	userID := GetUserID(r.Context())
	if entityType == "ca" {
		if !h.auth.UserHasCAAccess(userID, entityID) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
	} else {
		var caID sql.NullString
		err := h.db.QueryRow("SELECT certificate_authority_id FROM certificates WHERE id = ?", entityID).Scan(&caID)
		if err != nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		if caID.Valid && caID.String != "" && !h.auth.UserHasCAAccess(userID, caID.String) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
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

	// Claim the token before serving: the delete is the single-use check, so
	// two concurrent requests can never both download the file.
	err := h.db.QueryRow(
		"DELETE FROM share_links WHERE token = ? RETURNING entity_type, entity_id, file_type, expires_at", token,
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

	w.Header().Set("Cache-Control", "no-store")
	if entityType == "certificate" {
		h.serveCertFile(w, r, entityID, fileType)
	} else {
		h.serveCAFile(w, r, entityID, fileType)
	}
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
		if err := WriteBundle(w, files, format); err != nil {
			logger.Errorf("Failed to write share bundle stream: %v", err)
		}
	}
}

func (h *ShareHandler) serveCAFile(w http.ResponseWriter, r *http.Request, id string, fileType string) {
	var name, description string
	var version int
	var encPassphrase []byte
	err := h.db.QueryRow(`
		SELECT name, description, current_version, COALESCE(key_encrypted_passphrase, X'')
		FROM certificate_authorities WHERE id = ?
	`, id).Scan(&name, &description, &version, &encPassphrase)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	var passphrase string
	if len(encPassphrase) > 0 {
		decrypted, err := h.crypto.Decrypt(encPassphrase)
		if err == nil {
			passphrase = string(decrypted)
		}
	}

	certPEM, keyPEM, err := h.ca.ReadCA(name, version, passphrase)
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
		if err := WriteBundle(w, files, format); err != nil {
			logger.Errorf("Failed to write share bundle stream: %v", err)
		}
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

// SendShareEmail emails an existing share link. The link is rebuilt here from
// the token and the configured public URL, never taken from the client, so
// the endpoint cannot relay arbitrary links through the server's mail.
func (h *ShareHandler) SendShareEmail(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email    string `json:"email"`
		Token    string `json:"token"`
		FileName string `json:"fileName"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if req.Email == "" || req.Token == "" || req.FileName == "" {
		http.Error(w, "email, token, and fileName are required", http.StatusBadRequest)
		return
	}
	if h.publicURL == "" {
		http.Error(w, "emailing links needs the server's PUBLIC_URL setting", http.StatusServiceUnavailable)
		return
	}

	var expiresAt time.Time
	err := h.db.QueryRow("SELECT expires_at FROM share_links WHERE token = ?", req.Token).Scan(&expiresAt)
	if err != nil || time.Now().After(expiresAt) {
		http.Error(w, "share link not found or expired", http.StatusNotFound)
		return
	}

	fileName := sanitizeFilename(req.FileName)
	if len(fileName) > 128 {
		fileName = fileName[:128]
	}
	shareURL := h.publicURL + "/api/share/" + req.Token
	subject := fmt.Sprintf("GLCert Share Link — %s", fileName)
	htmlBody := buildShareEmailBody(fileName, shareURL)

	if err := h.email.SendEmail(req.Email, subject, htmlBody); err != nil {
		http.Error(w, "failed to send email: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// buildShareEmailBody renders the share email. All user-controlled values are
// HTML-escaped so a malicious file name or URL cannot inject markup into the
// email sent to the recipient.
func buildShareEmailBody(fileName, url string) string {
	safeName := html.EscapeString(fileName)
	safeURL := html.EscapeString(url)
	return fmt.Sprintf(`<h2>GLCert Share Link</h2>
<p>A temporary share link has been generated for <strong>%s</strong>.</p>
<p>This link expires in <strong>15 minutes</strong> and can only be used once.</p>
<h3>Download</h3>
<p><a href="%s">%s</a></p>
<h3>wget</h3>
<pre>wget -O %s "%s"</pre>
<h3>curl</h3>
<pre>curl -L -o %s "%s"</pre>`,
		safeName, safeURL, safeURL, safeName, safeURL, safeName, safeURL)
}
