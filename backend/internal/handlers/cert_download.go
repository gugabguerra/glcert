package handlers

import (
	"fmt"
	"net/http"

	"github.com/glcert/glcert/internal/logger"
	"github.com/go-chi/chi/v5"
)

func (h *CertHandler) DownloadCert(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var name, certType string
	var version int
	err := h.db.QueryRow("SELECT name, type, current_version FROM certificates WHERE id = ?", id).Scan(&name, &certType, &version)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	certPEM, _, _, err := h.cert.ReadCert(certType, name, version)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/x-pem-file")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s-cert.pem\"", name))
	w.Write(certPEM)
}

func (h *CertHandler) DownloadKey(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var name, certType string
	var version int
	err := h.db.QueryRow("SELECT name, type, current_version FROM certificates WHERE id = ?", id).Scan(&name, &certType, &version)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	_, keyPEM, _, err := h.cert.ReadCert(certType, name, version)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/x-pem-file")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s-key.pem\"", name))
	w.Write(keyPEM)
}

func (h *CertHandler) DownloadCA(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var name, certType string
	var version int
	err := h.db.QueryRow("SELECT name, type, current_version FROM certificates WHERE id = ?", id).Scan(&name, &certType, &version)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	_, _, caPEM, err := h.cert.ReadCert(certType, name, version)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if caPEM == nil {
		http.Error(w, "no CA certificate", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/x-pem-file")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s-ca.pem\"", name))
	w.Write(caPEM)
}

func (h *CertHandler) DownloadBundle(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	format := r.URL.Query().Get("format")
	if format != "tgz" {
		format = "zip"
	}

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
		logger.Errorf("Failed to write bundle stream: %v", err)
	}
}

func (h *CertHandler) DownloadGroup(w http.ResponseWriter, r *http.Request) {
	groupName := r.URL.Query().Get("name")
	if groupName == "" {
		http.Error(w, "group name is required", http.StatusBadRequest)
		return
	}

	format := r.URL.Query().Get("format")
	if format != "tgz" {
		format = "zip"
	}

	caCond, caArgs, filtered := h.accessibleCAFilter(GetUserID(r.Context()))

	query := `
		SELECT name, type, current_version FROM certificates
		WHERE group_name = ?
	`
	if filtered {
		query += " AND " + caCond
	}
	query += `
		ORDER BY name
	`

	args := []interface{}{groupName}
	args = append(args, caArgs...)

	rows, err := h.db.Query(query, args...)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type bundleCert struct {
		Name    string
		Type    string
		Version int
	}
	var certs []bundleCert
	for rows.Next() {
		var c bundleCert
		if err := rows.Scan(&c.Name, &c.Type, &c.Version); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		certs = append(certs, c)
	}

	if len(certs) == 0 {
		http.Error(w, "no certificates in group", http.StatusNotFound)
		return
	}

	var files []BundleFile
	for _, c := range certs {
		certPEM, keyPEM, caPEM, err := h.cert.ReadCert(c.Type, c.Name, c.Version)
		if err != nil {
			logger.Errorf("Group bundle: failed to read cert %s: %v", c.Name, err)
			continue
		}

		prefix := sanitizeFilename(c.Name)
		files = append(files, BundleFile{Name: prefix + "-cert.pem", Content: certPEM})
		files = append(files, BundleFile{Name: prefix + "-key.pem", Content: keyPEM})
		if caPEM != nil {
			files = append(files, BundleFile{Name: prefix + "-ca.pem", Content: caPEM})
		}
	}

	if len(files) == 0 {
		http.Error(w, "no certificate files found", http.StatusInternalServerError)
		return
	}

	safeName := sanitizeFilename(groupName)
	w.Header().Set("Content-Type", BundleContentType(format))
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s%s\"", safeName, BundleExtension(format)))
	if err := WriteBundle(w, files, format); err != nil {
		logger.Errorf("Failed to write group bundle stream: %v", err)
	}
}
