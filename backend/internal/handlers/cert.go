package handlers

import (
	"crypto/x509"
	"database/sql"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/glcert/glcert/internal/models"
	"github.com/glcert/glcert/internal/services"
	"github.com/google/uuid"
)

type CertHandler struct {
	db     *sql.DB
	cert   *services.CertService
	ca     *services.CAService
	crypto *services.CryptoService
}

func NewCertHandler(db *sql.DB, cert *services.CertService, ca *services.CAService, crypto *services.CryptoService) *CertHandler {
	return &CertHandler{db: db, cert: cert, ca: ca, crypto: crypto}
}

func (h *CertHandler) readCAWithPassphrase(caID string) ([]byte, []byte, error) {
	var caName string
	var caVersion int
	var encPassphrase []byte
	err := h.db.QueryRow(`
		SELECT ca.name, ca.current_version, COALESCE(ca.key_encrypted_passphrase, X'')
		FROM certificate_authorities ca WHERE ca.id = ?
	`, caID).Scan(&caName, &caVersion, &encPassphrase)
	if err != nil {
		return nil, nil, fmt.Errorf("certificate authority not found: %w", err)
	}

	var passphrase string
	if len(encPassphrase) > 0 {
		decrypted, err := h.crypto.Decrypt(encPassphrase)
		if err == nil {
			passphrase = string(decrypted)
		}
	}

	return h.ca.ReadCA(caName, caVersion, passphrase)
}

type CreateCertRequest struct {
	Name                  string   `json:"name"`
	Description           string   `json:"description"`
	CommonName            string   `json:"commonName"`
	Type                  string   `json:"type"`
	CertificateAuthorityID *string `json:"certificateAuthorityId"`
	DNSNames              []string `json:"dnsNames"`
	IPAddresses           []string `json:"ipAddresses"`
	Organization          string   `json:"organization"`
	Country               string   `json:"country"`
	State                 string   `json:"state"`
	City                  string   `json:"city"`
	KeyAlgorithm          string   `json:"keyAlgorithm"`
	RSAKeySize            int      `json:"rsaKeySize"`
	ValidityDays          int      `json:"validityDays"`
}

func (h *CertHandler) List(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Query(`
		SELECT c.id, c.name, c.description, c.type, c.certificate_authority_id,
			c.current_version, c.created_at, c.updated_at,
			COALESCE(ca.name, '') as ca_name,
			COALESCE(c.ca_subject, ''),
			cv.expires_at
		FROM certificates c
		LEFT JOIN certificate_authorities ca ON c.certificate_authority_id = ca.id
		LEFT JOIN certificate_versions cv ON cv.certificate_id = c.id AND cv.version = c.current_version
		ORDER BY c.created_at DESC
	`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type CertWithCA struct {
		models.Certificate
		CAName    string     `json:"caName"`
		ExpiresAt *time.Time `json:"expiresAt"`
	}

	var certs []CertWithCA
	for rows.Next() {
		var c CertWithCA
		if err := rows.Scan(&c.ID, &c.Name, &c.Description, &c.Type, &c.CertificateAuthorityID,
			&c.CurrentVersion, &c.CreatedAt, &c.UpdatedAt, &c.CAName, &c.CASubject, &c.ExpiresAt); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		certs = append(certs, c)
	}

	if certs == nil {
		certs = []CertWithCA{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(certs)
}

func (h *CertHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	type CertDetail struct {
		models.Certificate
		CAName      string   `json:"caName"`
		CommonName  string   `json:"commonName"`
		DNSNames    []string `json:"dnsNames"`
		IPAddresses []string `json:"ipAddresses"`
	}

	var c CertDetail
	var dnsNamesJSON, ipAddressesJSON sql.NullString
	var commonName, organization, country, state, city string
	err := h.db.QueryRow(`
		SELECT c.id, c.name, c.description, c.type, c.certificate_authority_id,
			c.current_version, c.created_at, c.updated_at,
			COALESCE(ca.name, '') as ca_name,
			COALESCE(c.ca_subject, ''),
			COALESCE(c.common_name, ''), COALESCE(c.organization, ''),
			COALESCE(c.country, ''), COALESCE(c.state, ''), COALESCE(c.city, ''),
			c.dns_names, c.ip_addresses
		FROM certificates c
		LEFT JOIN certificate_authorities ca ON c.certificate_authority_id = ca.id
		WHERE c.id = ?
	`, id).Scan(&c.ID, &c.Name, &c.Description, &c.Type, &c.CertificateAuthorityID,
		&c.CurrentVersion, &c.CreatedAt, &c.UpdatedAt, &c.CAName, &c.CASubject,
		&commonName, &organization, &country, &state, &city,
		&dnsNamesJSON, &ipAddressesJSON)
	if err == sql.ErrNoRows {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	c.CommonName = commonName
	if dnsNamesJSON.Valid {
		json.Unmarshal([]byte(dnsNamesJSON.String), &c.DNSNames)
	}
	if ipAddressesJSON.Valid {
		json.Unmarshal([]byte(ipAddressesJSON.String), &c.IPAddresses)
	}
	if c.DNSNames == nil {
		c.DNSNames = []string{}
	}
	if c.IPAddresses == nil {
		c.IPAddresses = []string{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(c)
}

func (h *CertHandler) GetVersions(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	rows, err := h.db.Query(`
		SELECT id, certificate_id, version, storage_path, serial_number,
			fingerprint, signature_algorithm, public_key_algorithm,
			created_at, expires_at, revoked
		FROM certificate_versions
		WHERE certificate_id = ?
		ORDER BY version DESC
	`, id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var versions []models.CertificateVersion
	for rows.Next() {
		var v models.CertificateVersion
		if err := rows.Scan(&v.ID, &v.CertificateID, &v.Version, &v.StoragePath,
			&v.SerialNumber, &v.Fingerprint, &v.SignatureAlgorithm, &v.PublicKeyAlgorithm,
			&v.CreatedAt, &v.ExpiresAt, &v.Revoked); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		versions = append(versions, v)
	}

	if versions == nil {
		versions = []models.CertificateVersion{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(versions)
}

func (h *CertHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req CreateCertRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if req.Name == "" || req.CommonName == "" || req.Type == "" {
		http.Error(w, "name, commonName, and type are required", http.StatusBadRequest)
		return
	}

	if req.Type != "server" && req.Type != "client" && req.Type != "selfsigned" {
		http.Error(w, "type must be server, client, or selfsigned", http.StatusBadRequest)
		return
	}

	if req.Type != "selfsigned" && req.CertificateAuthorityID == nil {
		http.Error(w, "certificateAuthorityId is required for server/client certificates", http.StatusBadRequest)
		return
	}

	var caCertPEM, caKeyPEM []byte
	var caSubject string
	if req.Type != "selfsigned" && req.CertificateAuthorityID != nil {
		var err error
		caCertPEM, caKeyPEM, err = h.readCAWithPassphrase(*req.CertificateAuthorityID)
		if err != nil {
			log.Printf("create certificate error: %v", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		h.db.QueryRow("SELECT subject FROM certificate_authorities WHERE id = ?", *req.CertificateAuthorityID).Scan(&caSubject)
	}

	result, err := h.cert.GenerateCert(services.CreateCertInput{
		Name:              req.Name,
		Description:       req.Description,
		CommonName:        req.CommonName,
		Type:              req.Type,
		CertificateAuthID: req.CertificateAuthorityID,
		DNSNames:          req.DNSNames,
		IPAddresses:       req.IPAddresses,
		Organization:      req.Organization,
		Country:           req.Country,
		State:             req.State,
		City:              req.City,
		KeyAlgorithm:      req.KeyAlgorithm,
		RSAKeySize:        req.RSAKeySize,
		ValidityDays:      req.ValidityDays,
	}, caCertPEM, caKeyPEM)
	if err != nil {
		log.Printf("create certificate error: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Save files
	if err := h.cert.SaveCert(req.Type, req.Name, 1, result.CertPEM, result.KeyPEM, result.CAPem); err != nil {
		log.Printf("create certificate error: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Insert certificate
	dnsNamesBytes, _ := json.Marshal(req.DNSNames)
	ipAddressesBytes, _ := json.Marshal(req.IPAddresses)
	certID := uuid.New().String()
	_, err = h.db.Exec(`
		INSERT INTO certificates (id, name, description, type, certificate_authority_id, current_version,
			common_name, organization, country, state, city, dns_names, ip_addresses, ca_subject)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, certID, req.Name, req.Description, req.Type, req.CertificateAuthorityID, 1,
		req.CommonName, req.Organization, req.Country, req.State, req.City,
		string(dnsNamesBytes), string(ipAddressesBytes), caSubject)
	if err != nil {
		log.Printf("create certificate error: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	result.Cert.ID = certID

	// Parse cert to get metadata
	parsedCert, _ := parseCert(result.CertPEM)
	fingerprint := ""
	serialNumber := ""
	sigAlgo := ""
	pubKeyAlgo := ""
	var expiresAt interface{}
	if parsedCert != nil {
		fingerprint = fmt.Sprintf("%x", parsedCert.SerialNumber)
		serialNumber = parsedCert.SerialNumber.String()
		sigAlgo = parsedCert.SignatureAlgorithm.String()
		pubKeyAlgo = parsedCert.PublicKeyAlgorithm.String()
		expiresAt = parsedCert.NotAfter
	}

	// Insert version
	storagePath := h.cert.GetCertPath(req.Type, req.Name, 1)
	_, err = h.db.Exec(`
		INSERT INTO certificate_versions (certificate_id, version, storage_path, serial_number,
			fingerprint, signature_algorithm, public_key_algorithm, expires_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, certID, 1, storagePath, serialNumber, fingerprint, sigAlgo, pubKeyAlgo, expiresAt)
	if err != nil {
		log.Printf("create certificate error: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(result.Cert)
}

func (h *CertHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var name, certType string
	err := h.db.QueryRow("SELECT name, type FROM certificates WHERE id = ?", id).Scan(&name, &certType)
	if err == sql.ErrNoRows {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if _, err := h.db.Exec("DELETE FROM certificate_versions WHERE certificate_id = ?", id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if _, err := h.db.Exec("DELETE FROM certificates WHERE id = ?", id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	h.cert.DeleteCert(certType, name)

	w.WriteHeader(http.StatusNoContent)
}

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
	WriteBundle(w, files, format)
}

func (h *CertHandler) Regenerate(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	// Get existing certificate info
	var name, certType, description, commonName, org, country, state, city string
	var caID sql.NullString
	var currentVersion int
	var dnsNamesJSON, ipAddressesJSON sql.NullString

	err := h.db.QueryRow(`
		SELECT name, type, description, common_name, organization, country, state, city,
			certificate_authority_id, current_version, dns_names, ip_addresses
		FROM certificates WHERE id = ?
	`, id).Scan(&name, &certType, &description, &commonName, &org, &country, &state, &city,
		&caID, &currentVersion, &dnsNamesJSON, &ipAddressesJSON)
	if err == sql.ErrNoRows {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	var dnsNames []string
	var ipAddresses []string
	if dnsNamesJSON.Valid {
		json.Unmarshal([]byte(dnsNamesJSON.String), &dnsNames)
	}
	if ipAddressesJSON.Valid {
		json.Unmarshal([]byte(ipAddressesJSON.String), &ipAddresses)
	}

	var caCertPEM, caKeyPEM []byte
	var caSubject string
	if certType != "selfsigned" && caID.Valid {
		caCertPEM, caKeyPEM, err = h.readCAWithPassphrase(caID.String)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		h.db.QueryRow("SELECT subject FROM certificate_authorities WHERE id = ?", caID.String).Scan(&caSubject)
	}

	var req struct {
		ValidityDays int `json:"validityDays"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	if req.ValidityDays <= 0 {
		req.ValidityDays = 365
	}

	newVersion := currentVersion + 1

	result, err := h.cert.GenerateCert(services.CreateCertInput{
		Name:              name,
		Description:       description,
		CommonName:        commonName,
		Type:              certType,
		CertificateAuthID: func() *string { if caID.Valid { return &caID.String }; return nil }(),
		DNSNames:          dnsNames,
		IPAddresses:       ipAddresses,
		Organization:      org,
		Country:           country,
		State:             state,
		City:              city,
		KeyAlgorithm:      "rsa",
		RSAKeySize:        2048,
		ValidityDays:      req.ValidityDays,
	}, caCertPEM, caKeyPEM)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if err := h.cert.SaveCert(certType, name, newVersion, result.CertPEM, result.KeyPEM, result.CAPem); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	parsedCert, _ := parseCert(result.CertPEM)
	fingerprint := ""
	serialNumber := ""
	sigAlgo := ""
	pubKeyAlgo := ""
	var expiresAt interface{}
	expiresAt = nil
	if parsedCert != nil {
		fingerprint = fmt.Sprintf("%x", parsedCert.SerialNumber)
		serialNumber = parsedCert.SerialNumber.String()
		sigAlgo = parsedCert.SignatureAlgorithm.String()
		pubKeyAlgo = parsedCert.PublicKeyAlgorithm.String()
		expiresAt = parsedCert.NotAfter
	}

	storagePath := h.cert.GetCertPath(certType, name, newVersion)
	_, err = h.db.Exec(`
		INSERT INTO certificate_versions (certificate_id, version, storage_path, serial_number,
			fingerprint, signature_algorithm, public_key_algorithm, expires_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, id, newVersion, storagePath, serialNumber, fingerprint, sigAlgo, pubKeyAlgo, expiresAt)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	_, err = h.db.Exec("UPDATE certificates SET current_version = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", newVersion, id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]int{"version": newVersion})
}

func (h *CertHandler) RestoreVersion(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	version, err := strconv.Atoi(chi.URLParam(r, "version"))
	if err != nil {
		http.Error(w, "invalid version", http.StatusBadRequest)
		return
	}

	var exists bool
	err = h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM certificate_versions WHERE certificate_id = ? AND version = ?)", id, version).Scan(&exists)
	if err != nil || !exists {
		http.Error(w, "version not found", http.StatusNotFound)
		return
	}

	_, err = h.db.Exec("UPDATE certificates SET current_version = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", version, id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *CertHandler) DeleteVersion(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	version, err := strconv.Atoi(chi.URLParam(r, "version"))
	if err != nil {
		http.Error(w, "invalid version", http.StatusBadRequest)
		return
	}

	var currentVersion int
	err = h.db.QueryRow("SELECT current_version FROM certificates WHERE id = ?", id).Scan(&currentVersion)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	if version == currentVersion {
		http.Error(w, "cannot delete current version", http.StatusBadRequest)
		return
	}

	var name, certType string
	var storagePath string
	err = h.db.QueryRow(`
		SELECT c.name, c.type, cv.storage_path
		FROM certificates c
		JOIN certificate_versions cv ON cv.certificate_id = c.id AND cv.version = ?
		WHERE c.id = ?
	`, version, id).Scan(&name, &certType, &storagePath)
	if err != nil {
		http.Error(w, "version not found", http.StatusNotFound)
		return
	}

	h.cert.DeleteVersion(certType, name, version)

	_, err = h.db.Exec("DELETE FROM certificate_versions WHERE certificate_id = ? AND version = ?", id, version)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func parseCert(pemBytes []byte) (*x509.Certificate, error) {
	block, _ := pem.Decode(pemBytes)
	if block == nil {
		return nil, fmt.Errorf("decode PEM")
	}
	return x509.ParseCertificate(block.Bytes)
}
