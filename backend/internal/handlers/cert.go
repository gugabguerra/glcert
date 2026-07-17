package handlers

import (
	"archive/zip"
	"crypto/x509"
	"database/sql"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/glcert/glcert/internal/models"
	"github.com/glcert/glcert/internal/services"
)

type CertHandler struct {
	db   *sql.DB
	cert *services.CertService
	ca   *services.CAService
}

func NewCertHandler(db *sql.DB, cert *services.CertService, ca *services.CAService) *CertHandler {
	return &CertHandler{db: db, cert: cert, ca: ca}
}

type CreateCertRequest struct {
	Name                  string   `json:"name"`
	Description           string   `json:"description"`
	CommonName            string   `json:"commonName"`
	Type                  string   `json:"type"`
	CertificateAuthorityID *int64  `json:"certificateAuthorityId"`
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
			COALESCE(ca.name, '') as ca_name
		FROM certificates c
		LEFT JOIN certificate_authorities ca ON c.certificate_authority_id = ca.id
		ORDER BY c.created_at DESC
	`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type CertWithCA struct {
		models.Certificate
		CAName string `json:"caName"`
	}

	var certs []CertWithCA
	for rows.Next() {
		var c CertWithCA
		if err := rows.Scan(&c.ID, &c.Name, &c.Description, &c.Type, &c.CertificateAuthorityID,
			&c.CurrentVersion, &c.CreatedAt, &c.UpdatedAt, &c.CAName); err != nil {
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
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	type CertWithCA struct {
		models.Certificate
		CAName string `json:"caName"`
	}

	var c CertWithCA
	err = h.db.QueryRow(`
		SELECT c.id, c.name, c.description, c.type, c.certificate_authority_id,
			c.current_version, c.created_at, c.updated_at,
			COALESCE(ca.name, '') as ca_name
		FROM certificates c
		LEFT JOIN certificate_authorities ca ON c.certificate_authority_id = ca.id
		WHERE c.id = ?
	`, id).Scan(&c.ID, &c.Name, &c.Description, &c.Type, &c.CertificateAuthorityID,
		&c.CurrentVersion, &c.CreatedAt, &c.UpdatedAt, &c.CAName)
	if err == sql.ErrNoRows {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(c)
}

func (h *CertHandler) GetVersions(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

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
	if req.Type != "selfsigned" && req.CertificateAuthorityID != nil {
		var caName string
		var caVersion int
		err := h.db.QueryRow("SELECT name, current_version FROM certificate_authorities WHERE id = ?",
			*req.CertificateAuthorityID).Scan(&caName, &caVersion)
		if err == sql.ErrNoRows {
			http.Error(w, "certificate authority not found", http.StatusNotFound)
			return
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		caCertPEM, caKeyPEM, err = h.ca.ReadCA(caName, caVersion)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
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
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Save files
	if err := h.cert.SaveCert(req.Type, req.Name, 1, result.CertPEM, result.KeyPEM, result.CAPem); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Insert certificate
	dnsNamesBytes, _ := json.Marshal(req.DNSNames)
	ipAddressesBytes, _ := json.Marshal(req.IPAddresses)
	certResult, err := h.db.Exec(`
		INSERT INTO certificates (name, description, type, certificate_authority_id, current_version,
			common_name, organization, country, state, city, dns_names, ip_addresses)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, req.Name, req.Description, req.Type, req.CertificateAuthorityID, 1,
		req.CommonName, req.Organization, req.Country, req.State, req.City,
		string(dnsNamesBytes), string(ipAddressesBytes))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	certID, _ := certResult.LastInsertId()
	result.Cert.ID = certID

	// Parse cert to get metadata
	parsedCert, _ := parseCert(result.CertPEM)
	fingerprint := ""
	serialNumber := ""
	sigAlgo := ""
	pubKeyAlgo := ""
	if parsedCert != nil {
		fingerprint = fmt.Sprintf("%x", parsedCert.SerialNumber)
		serialNumber = parsedCert.SerialNumber.String()
		sigAlgo = parsedCert.SignatureAlgorithm.String()
		pubKeyAlgo = parsedCert.PublicKeyAlgorithm.String()
	}

	// Insert version
	storagePath := h.cert.GetCertPath(req.Type, req.Name, 1)
	_, err = h.db.Exec(`
		INSERT INTO certificate_versions (certificate_id, version, storage_path, serial_number,
			fingerprint, signature_algorithm, public_key_algorithm, expires_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, certID, 1, storagePath, serialNumber, fingerprint, sigAlgo, pubKeyAlgo, parsedCert.NotAfter)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(result.Cert)
}

func (h *CertHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	var name, certType string
	err = h.db.QueryRow("SELECT name, type FROM certificates WHERE id = ?", id).Scan(&name, &certType)
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
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	var name, certType string
	var version int
	err = h.db.QueryRow("SELECT name, type, current_version FROM certificates WHERE id = ?", id).Scan(&name, &certType, &version)
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
	w.Header().Set("Content-Disposition", "attachment; filename=\"cert.pem\"")
	w.Write(certPEM)
}

func (h *CertHandler) DownloadKey(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	var name, certType string
	var version int
	err = h.db.QueryRow("SELECT name, type, current_version FROM certificates WHERE id = ?", id).Scan(&name, &certType, &version)
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
	w.Header().Set("Content-Disposition", "attachment; filename=\"key.pem\"")
	w.Write(keyPEM)
}

func (h *CertHandler) DownloadCA(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	var name, certType string
	var version int
	err = h.db.QueryRow("SELECT name, type, current_version FROM certificates WHERE id = ?", id).Scan(&name, &certType, &version)
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
	w.Header().Set("Content-Disposition", "attachment; filename=\"ca.pem\"")
	w.Write(caPEM)
}

func (h *CertHandler) DownloadBundle(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	var name, certType, description string
	var version int
	err = h.db.QueryRow("SELECT name, type, description, current_version FROM certificates WHERE id = ?", id).Scan(&name, &certType, &description, &version)
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

func (h *CertHandler) DownloadCABundle(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	var name, description string
	var version int
	err = h.db.QueryRow("SELECT name, description, current_version FROM certificate_authorities WHERE id = ?", id).Scan(&name, &description, &version)
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

func (h *CertHandler) Regenerate(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	// Get existing certificate info
	var name, certType, description, commonName, org, country, state, city string
	var caID sql.NullInt64
	var currentVersion int
	var dnsNamesJSON, ipAddressesJSON sql.NullString

	err = h.db.QueryRow(`
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
	if certType != "selfsigned" && caID.Valid {
		var caName string
		var caVersion int
		err = h.db.QueryRow("SELECT name, current_version FROM certificate_authorities WHERE id = ?", caID.Int64).Scan(&caName, &caVersion)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		caCertPEM, caKeyPEM, err = h.ca.ReadCA(caName, caVersion)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}

	newVersion := currentVersion + 1

	result, err := h.cert.GenerateCert(services.CreateCertInput{
		Name:              name,
		Description:       description,
		CommonName:        commonName,
		Type:              certType,
		CertificateAuthID: func() *int64 { if caID.Valid { return &caID.Int64 }; return nil }(),
		DNSNames:          dnsNames,
		IPAddresses:       ipAddresses,
		Organization:      org,
		Country:           country,
		State:             state,
		City:              city,
		KeyAlgorithm:      "rsa",
		RSAKeySize:        2048,
		ValidityDays:      365,
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
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

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
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

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
