package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/gugabguerra/glcert/internal/models"
	"github.com/gugabguerra/glcert/internal/services"
)

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

	// Keep the key algorithm, size and curve of the current version.
	keyParams := services.KeyParams{Algorithm: "rsa", RSAKeySize: 2048}
	if currentCertPEM, _, _, rErr := h.cert.ReadCert(certType, name, currentVersion); rErr == nil {
		if p, pErr := services.KeyParamsFromCertPEM(currentCertPEM); pErr == nil {
			keyParams = p
		}
	}

	result, err := h.cert.GenerateCert(services.CreateCertInput{
		Name:        name,
		Description: description,
		CommonName:  commonName,
		Type:        certType,
		CertificateAuthID: func() *string {
			if caID.Valid {
				return &caID.String
			}
			return nil
		}(),
		DNSNames:     dnsNames,
		IPAddresses:  ipAddresses,
		Organization: org,
		Country:      country,
		State:        state,
		City:         city,
		KeyAlgorithm: keyParams.Algorithm,
		RSAKeySize:   keyParams.RSAKeySize,
		ECDSACurve:   keyParams.ECDSACurve,
		ValidityDays: req.ValidityDays,
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
	recordAudit(h.db, r, "certificate.regenerate", "certificate", id, fmt.Sprintf("%s (v%d)", name, newVersion))

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
