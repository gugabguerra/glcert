package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gugabguerra/glcert/internal/backup"
	"github.com/gugabguerra/glcert/internal/logger"
)

type BackupHandler struct {
	db      *sql.DB
	dataDir string
}

func NewBackupHandler(db *sql.DB, dataDir string) *BackupHandler {
	return &BackupHandler{db: db, dataDir: dataDir}
}

func (h *BackupHandler) CreateBackup(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Password == "" {
		http.Error(w, "password is required", http.StatusBadRequest)
		return
	}

	reader, _, err := backup.CreateBackup(h.dataDir, req.Password)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	name := backup.GenerateBackupName()
	recordAudit(h.db, r, "backup.create", "backup", name, name)

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", "attachment; filename=\""+name+"\"")

	io.Copy(w, reader)
}

func (h *BackupHandler) RestoreBackup(w http.ResponseWriter, r *http.Request) {
	// Cap the restore upload so an oversized payload cannot exhaust
	// memory or disk (backups are DB + certificate files).
	r.Body = http.MaxBytesReader(w, r.Body, 128<<20)

	if err := r.ParseMultipartForm(32 << 20); err != nil {
		http.Error(w, "invalid form data", http.StatusBadRequest)
		return
	}

	password := r.FormValue("password")
	if password == "" {
		http.Error(w, "password is required", http.StatusBadRequest)
		return
	}

	file, _, err := r.FormFile("backup")
	if err != nil {
		http.Error(w, "backup file is required", http.StatusBadRequest)
		return
	}
	defer file.Close()

	backupData, err := io.ReadAll(file)
	if err != nil {
		http.Error(w, "read backup file: "+err.Error(), http.StatusInternalServerError)
		return
	}

	meta, err := backup.ValidateBackup(backupData, password)
	if err != nil {
		http.Error(w, "invalid backup: "+err.Error(), http.StatusBadRequest)
		return
	}

	files, err := backup.ExtractBackupFiles(backupData, password)
	if err != nil {
		http.Error(w, "extract backup: "+err.Error(), http.StatusInternalServerError)
		return
	}

	dbData, ok := files["database.sqlite"]
	if !ok {
		http.Error(w, "database.sqlite not found in backup", http.StatusBadRequest)
		return
	}

	tempDBPath := filepath.Join(h.dataDir, "restore_temp.sqlite")
	if err := os.WriteFile(tempDBPath, dbData, 0644); err != nil {
		http.Error(w, "write temp database: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer os.Remove(tempDBPath)

	if err := h.mergeDatabase(tempDBPath); err != nil {
		http.Error(w, "merge database: "+err.Error(), http.StatusInternalServerError)
		return
	}

	certFiles := backup.CertFilesFromBackup(files)
	for name, data := range certFiles {
		rel := strings.TrimPrefix(name, "certificates/")
		clean := filepath.Clean(filepath.FromSlash(rel))
		// Reject any entry that escapes the data dir (zip slip).
		if clean == "." || clean == ".." ||
			strings.HasPrefix(clean, ".."+string(filepath.Separator)) ||
			filepath.IsAbs(clean) {
			logger.Warnf("restore: skipping unsafe path %q", name)
			continue
		}
		outPath := filepath.Join(h.dataDir, "certificates", clean)
		if !strings.HasPrefix(filepath.Clean(outPath), filepath.Clean(h.dataDir)+string(filepath.Separator)) {
			logger.Warnf("restore: skipping path escaping data dir: %q", name)
			continue
		}
		dir := filepath.Dir(outPath)
		if err := os.MkdirAll(dir, 0755); err != nil {
			continue
		}
		if err := os.WriteFile(outPath, data, 0644); err != nil {
			logger.Warnf("restore: failed to write %q: %v", name, err)
		}
	}

	stamp := meta.Timestamp.Format("2006-01-02 15:04:05")
	recordAudit(h.db, r, "backup.restore", "backup", "", "Backup from "+stamp)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "ok",
		"message": "Backup restored from " + stamp,
	})
}

func (h *BackupHandler) mergeDatabase(tempDBPath string) error {
	backupDB, err := sql.Open("sqlite", "file:"+tempDBPath+"?mode=ro")
	if err != nil {
		return fmt.Errorf("open backup database: %w", err)
	}
	defer backupDB.Close()

	tx, err := h.db.Begin()
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	if err := h.mergeSettings(tx, backupDB); err != nil {
		return fmt.Errorf("merge settings: %w", err)
	}
	if err := h.mergeCAs(tx, backupDB); err != nil {
		return fmt.Errorf("merge certificate authorities: %w", err)
	}
	if err := h.mergeCerts(tx, backupDB); err != nil {
		return fmt.Errorf("merge certificates: %w", err)
	}
	if err := h.mergeCertVersions(tx, backupDB); err != nil {
		return fmt.Errorf("merge certificate versions: %w", err)
	}

	return tx.Commit()
}

func (h *BackupHandler) mergeSettings(tx *sql.Tx, backupDB *sql.DB) error {
	var org, country, state, city, email, keyAlgo, ecurve, webhook, smtpHost, smtpUser, smtpFromEmail, smtpFromName string
	var rsaSize, validity, threshold, smtpPort int
	var notifEnabled, emailNotifEnabled bool

	err := backupDB.QueryRow(`SELECT
		COALESCE(organization,''), COALESCE(country,''), COALESCE(state,''),
		COALESCE(city,''), COALESCE(email,''), COALESCE(default_key_algorithm,'rsa'),
		COALESCE(default_rsa_key_size,2048), COALESCE(default_ecdsa_curve,'P-256'),
		COALESCE(default_validity_days,365), COALESCE(notifications_enabled,0),
		COALESCE(notification_webhook_url,''), COALESCE(notification_threshold_days,30),
		COALESCE(smtp_host,''), COALESCE(smtp_port,587), COALESCE(smtp_username,''),
		COALESCE(smtp_from_email,''), COALESCE(smtp_from_name,'GLCert'),
		COALESCE(email_notifications_enabled,0)
		FROM settings WHERE id = 1`).Scan(
		&org, &country, &state, &city, &email, &keyAlgo,
		&rsaSize, &ecurve, &validity, &notifEnabled,
		&webhook, &threshold,
		&smtpHost, &smtpPort, &smtpUser,
		&smtpFromEmail, &smtpFromName, &emailNotifEnabled,
	)
	if err != nil {
		return fmt.Errorf("read settings from backup: %w", err)
	}

	_, err = tx.Exec(`UPDATE settings SET
		organization=?, country=?, state=?, city=?, email=?,
		default_key_algorithm=?, default_rsa_key_size=?, default_ecdsa_curve=?,
		default_validity_days=?, notifications_enabled=?,
		notification_webhook_url=?, notification_threshold_days=?,
		smtp_host=?, smtp_port=?, smtp_username=?,
		smtp_from_email=?, smtp_from_name=?, email_notifications_enabled=?
	WHERE id = 1`,
		org, country, state, city, email, keyAlgo,
		rsaSize, ecurve, validity, notifEnabled,
		webhook, threshold,
		smtpHost, smtpPort, smtpUser,
		smtpFromEmail, smtpFromName, emailNotifEnabled,
	)
	return err
}

func (h *BackupHandler) mergeCAs(tx *sql.Tx, backupDB *sql.DB) error {
	if _, err := tx.Exec(`DELETE FROM certificate_versions`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM certificates`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM certificate_authorities`); err != nil {
		return err
	}

	rows, err := backupDB.Query(`SELECT
		id, name, COALESCE(description,''), subject, created_at, expires_at,
		COALESCE(current_version,1), last_notified_at, key_encrypted_passphrase,
		COALESCE(imported,0)
	FROM certificate_authorities`)
	if err != nil {
		return fmt.Errorf("query certificate authorities: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var id, name, desc, subject string
		var createdAt, expiresAt sql.NullTime
		var currentVersion int
		var lastNotified sql.NullTime
		var keyPassphrase []byte
		var imported bool

		if err := rows.Scan(&id, &name, &desc, &subject, &createdAt, &expiresAt,
			&currentVersion, &lastNotified, &keyPassphrase, &imported); err != nil {
			return fmt.Errorf("scan certificate authority: %w", err)
		}

		_, err := tx.Exec(`INSERT INTO certificate_authorities
			(id, name, description, subject, created_at, expires_at,
			 current_version, last_notified_at, key_encrypted_passphrase, imported)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			id, name, desc, subject, createdAt.Time, expiresAt.Time,
			currentVersion, nullableTime(lastNotified), keyPassphrase, imported,
		)
		if err != nil {
			return fmt.Errorf("insert certificate authority %s: %w", name, err)
		}
	}
	return rows.Err()
}

func (h *BackupHandler) mergeCerts(tx *sql.Tx, backupDB *sql.DB) error {
	rows, err := backupDB.Query(`SELECT
		id, name, COALESCE(description,''), type, certificate_authority_id,
		COALESCE(current_version,1), created_at, updated_at,
		COALESCE(common_name,''), COALESCE(organization,''),
		COALESCE(country,''), COALESCE(state,''), COALESCE(city,''),
		COALESCE(dns_names,'[]'), COALESCE(ip_addresses,'[]'),
		last_notified_at, COALESCE(ca_subject,'')
	FROM certificates`)
	if err != nil {
		return fmt.Errorf("query certificates: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var id, name, desc, certType, cn, org, country, state, city, dnsNames, ipAddresses, caSubject string
		var caID sql.NullString
		var currentVersion int
		var createdAt, updatedAt sql.NullTime
		var lastNotified sql.NullTime

		if err := rows.Scan(&id, &name, &desc, &certType, &caID,
			&currentVersion, &createdAt, &updatedAt,
			&cn, &org, &country, &state, &city,
			&dnsNames, &ipAddresses,
			&lastNotified, &caSubject); err != nil {
			return fmt.Errorf("scan certificate: %w", err)
		}

		_, err := tx.Exec(`INSERT INTO certificates
			(id, name, description, type, certificate_authority_id,
			 current_version, created_at, updated_at,
			 common_name, organization, country, state, city,
			 dns_names, ip_addresses, last_notified_at, ca_subject)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			id, name, desc, certType, nullableString(caID),
			currentVersion, nullableTime(createdAt), nullableTime(updatedAt),
			cn, org, country, state, city,
			dnsNames, ipAddresses, nullableTime(lastNotified), caSubject,
		)
		if err != nil {
			return fmt.Errorf("insert certificate %s: %w", name, err)
		}
	}
	return rows.Err()
}

func (h *BackupHandler) mergeCertVersions(tx *sql.Tx, backupDB *sql.DB) error {
	rows, err := backupDB.Query(`SELECT
		id, certificate_id, version, storage_path, serial_number, fingerprint,
		signature_algorithm, public_key_algorithm, created_at, expires_at,
		COALESCE(revoked, 0)
	FROM certificate_versions`)
	if err != nil {
		return fmt.Errorf("query certificate versions: %w", err)
	}
	defer rows.Close()

	var maxVersionID int

	for rows.Next() {
		var id, version int
		var certID, storagePath, serial, fingerprint, sigAlgo, keyAlgo string
		var createdAt, expiresAt sql.NullTime
		var revoked bool

		if err := rows.Scan(&id, &certID, &version, &storagePath, &serial, &fingerprint,
			&sigAlgo, &keyAlgo, &createdAt, &expiresAt, &revoked); err != nil {
			return fmt.Errorf("scan certificate version: %w", err)
		}

		if id > maxVersionID {
			maxVersionID = id
		}

		_, err := tx.Exec(`INSERT INTO certificate_versions
			(id, certificate_id, version, storage_path, serial_number, fingerprint,
			 signature_algorithm, public_key_algorithm, created_at, expires_at, revoked)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			id, certID, version, storagePath, serial, fingerprint,
			sigAlgo, keyAlgo, nullableTime(createdAt), nullableTime(expiresAt), revoked,
		)
		if err != nil {
			return fmt.Errorf("insert certificate version %d: %w", id, err)
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}

	if maxVersionID > 0 {
		tx.Exec(`DELETE FROM sqlite_sequence WHERE name = 'certificate_versions'`)
		tx.Exec(`INSERT INTO sqlite_sequence (name, seq) VALUES ('certificate_versions', ?)`, maxVersionID)
	}

	return nil
}

func nullableTime(t sql.NullTime) interface{} {
	if t.Valid {
		return t.Time
	}
	return nil
}

func nullableString(s sql.NullString) interface{} {
	if s.Valid {
		return s.String
	}
	return nil
}
