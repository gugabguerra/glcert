package database

import (
	"database/sql"

	"github.com/gugabguerra/glcert/internal/logger"
)

func migrate(db *sql.DB) error {
	// Detect old schema (integer PKs) and drop for clean break
	var idType string
	err := db.QueryRow("SELECT type FROM pragma_table_info('certificate_authorities') WHERE name = 'id'").Scan(&idType)
	if err == nil && idType == "INTEGER" {
		logger.Infof("Detected old integer PK schema — dropping tables for UUID migration")
		dropTables := []string{"certificate_versions", "certificates", "certificate_authorities", "share_links"}
		for _, t := range dropTables {
			db.Exec("DROP TABLE IF EXISTS " + t)
		}
	}

	// Multi-user migration: detect old single-admin schema
	var adminExists int
	db.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='admin'").Scan(&adminExists)
	if adminExists > 0 {
		logger.Infof("Detected old single-admin schema — migrating to multi-user")
		if err := migrateToMultiUser(db); err != nil {
			return err
		}
	}

	queries := []string{
		`CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			name TEXT DEFAULT '',
			email TEXT NOT NULL UNIQUE,
			password_hash TEXT NOT NULL,
			role TEXT NOT NULL DEFAULT 'operator' CHECK(role IN ('admin', 'operator', 'viewer')),
			totp_secret BLOB,
			totp_enabled BOOLEAN DEFAULT FALSE,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS settings (
			id INTEGER PRIMARY KEY DEFAULT 1,
			organization TEXT DEFAULT '',
			country TEXT DEFAULT '',
			state TEXT DEFAULT '',
			city TEXT DEFAULT '',
			email TEXT DEFAULT '',
			default_key_algorithm TEXT DEFAULT 'rsa',
			default_rsa_key_size INTEGER DEFAULT 2048,
			default_ecdsa_curve TEXT DEFAULT 'P-256',
			default_validity_days INTEGER DEFAULT 365,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS certificate_authorities (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			description TEXT DEFAULT '',
			subject TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			expires_at DATETIME NOT NULL,
			current_version INTEGER DEFAULT 1
		)`,
		`CREATE TABLE IF NOT EXISTS certificates (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			description TEXT DEFAULT '',
			type TEXT NOT NULL CHECK(type IN ('server', 'client', 'serverclient', 'selfsigned')),
			certificate_authority_id TEXT,
			current_version INTEGER DEFAULT 1,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (certificate_authority_id) REFERENCES certificate_authorities(id)
		)`,
		`CREATE TABLE IF NOT EXISTS certificate_versions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			certificate_id TEXT NOT NULL,
			version INTEGER NOT NULL,
			storage_path TEXT NOT NULL,
			serial_number TEXT NOT NULL,
			fingerprint TEXT NOT NULL,
			signature_algorithm TEXT NOT NULL,
			public_key_algorithm TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			expires_at DATETIME NOT NULL,
			revoked BOOLEAN DEFAULT FALSE,
			FOREIGN KEY (certificate_id) REFERENCES certificates(id) ON DELETE CASCADE
		)`,
	}

	for _, q := range queries {
		if _, err := db.Exec(q); err != nil {
			return err
		}
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS share_links (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			token TEXT UNIQUE NOT NULL,
			entity_type TEXT NOT NULL CHECK (entity_type IN ('certificate', 'ca')),
			entity_id TEXT NOT NULL,
			expires_at DATETIME NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`)
	if err != nil {
		return err
	}

	// Sessions with user_id
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS sessions (
			token TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			expires_at DATETIME NOT NULL,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		)
	`)
	if err != nil {
		return err
	}

	// Pending sessions with user_id
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS pending_sessions (
			token TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			expires_at DATETIME NOT NULL,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		)
	`)
	if err != nil {
		return err
	}

	// Backup codes with user_id
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS backup_codes (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id TEXT NOT NULL,
			code_hash TEXT NOT NULL,
			used BOOLEAN DEFAULT FALSE,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		)
	`)
	if err != nil {
		return err
	}

	// Passkeys (WebAuthn second factor). credential is the library's JSON
	// record: public key, flags, and signature counter. Nothing in it is secret.
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS passkeys (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			credential_id BLOB NOT NULL UNIQUE,
			name TEXT NOT NULL DEFAULT '',
			credential TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			last_used_at DATETIME,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		)
	`)
	if err != nil {
		return err
	}
	db.Exec("CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkeys(user_id)")

	// Password resets
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS password_resets (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id TEXT NOT NULL,
			token TEXT NOT NULL,
			expires_at DATETIME NOT NULL,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		)
	`)
	if err != nil {
		return err
	}

	// CA permissions
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS ca_permissions (
			ca_id TEXT NOT NULL,
			user_id TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (ca_id, user_id),
			FOREIGN KEY (ca_id) REFERENCES certificate_authorities(id) ON DELETE CASCADE,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		)
	`)
	if err != nil {
		return err
	}

	// Audit log
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS audit_log (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id TEXT,
			user_email TEXT,
			action TEXT NOT NULL,
			entity_type TEXT,
			entity_id TEXT,
			details TEXT DEFAULT '',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`)
	if err != nil {
		return err
	}
	db.Exec("CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC)")

	// Add columns that may be missing from older schemas
	alterQueries := []string{
		`ALTER TABLE certificates ADD COLUMN common_name TEXT DEFAULT ''`,
		`ALTER TABLE certificates ADD COLUMN organization TEXT DEFAULT ''`,
		`ALTER TABLE certificates ADD COLUMN country TEXT DEFAULT ''`,
		`ALTER TABLE certificates ADD COLUMN state TEXT DEFAULT ''`,
		`ALTER TABLE certificates ADD COLUMN city TEXT DEFAULT ''`,
		`ALTER TABLE certificates ADD COLUMN dns_names TEXT DEFAULT '[]'`,
		`ALTER TABLE certificates ADD COLUMN ip_addresses TEXT DEFAULT '[]'`,
	}

	for _, q := range alterQueries {
		db.Exec(q) // ignore errors (column already exists)
	}

	notificationAlterQueries := []string{
		`ALTER TABLE settings ADD COLUMN notifications_enabled BOOLEAN DEFAULT 0`,
		`ALTER TABLE settings ADD COLUMN notification_webhook_url TEXT DEFAULT ''`,
		`ALTER TABLE settings ADD COLUMN notification_threshold_days INTEGER DEFAULT 30`,
		`ALTER TABLE certificates ADD COLUMN last_notified_at DATETIME`,
		`ALTER TABLE certificate_authorities ADD COLUMN last_notified_at DATETIME`,
	}

	for _, q := range notificationAlterQueries {
		db.Exec(q)
	}

	shareAlterQueries := []string{
		`ALTER TABLE share_links ADD COLUMN file_type TEXT NOT NULL DEFAULT 'bundle_zip'`,
	}

	for _, q := range shareAlterQueries {
		db.Exec(q)
	}

	smtpAlterQueries := []string{
		`ALTER TABLE settings ADD COLUMN smtp_host TEXT DEFAULT ''`,
		`ALTER TABLE settings ADD COLUMN smtp_port INTEGER DEFAULT 587`,
		`ALTER TABLE settings ADD COLUMN smtp_username TEXT DEFAULT ''`,
		`ALTER TABLE settings ADD COLUMN smtp_password TEXT DEFAULT ''`,
		`ALTER TABLE settings ADD COLUMN smtp_from_email TEXT DEFAULT ''`,
		`ALTER TABLE settings ADD COLUMN smtp_from_name TEXT DEFAULT 'GLCert'`,
		`ALTER TABLE settings ADD COLUMN email_notifications_enabled BOOLEAN DEFAULT 0`,
	}

	for _, q := range smtpAlterQueries {
		db.Exec(q)
	}

	passphraseAlterQueries := []string{
		`ALTER TABLE certificate_authorities ADD COLUMN key_encrypted_passphrase BLOB`,
		`ALTER TABLE certificate_authorities ADD COLUMN imported BOOLEAN DEFAULT FALSE`,
		`ALTER TABLE certificates ADD COLUMN ca_subject TEXT DEFAULT ''`,
		`ALTER TABLE certificate_authorities ADD COLUMN parent_ca_id TEXT`,
	}

	for _, q := range passphraseAlterQueries {
		db.Exec(q)
	}

	// Migrate certificates table CHECK constraint to include 'serverclient'
	var createSQL string
	err = db.QueryRow("SELECT sql FROM sqlite_master WHERE type='table' AND name='certificates'").Scan(&createSQL)
	if err == nil && createSQL != "" && !containsString(createSQL, "'serverclient'") {
		logger.Infof("Migrating certificates table to add 'serverclient' type")
		tx, txErr := db.Begin()
		if txErr != nil {
			return txErr
		}
		migrateQueries := []string{
			`CREATE TABLE certificates_new (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				description TEXT DEFAULT '',
				type TEXT NOT NULL CHECK(type IN ('server', 'client', 'serverclient', 'selfsigned')),
				certificate_authority_id TEXT,
				current_version INTEGER DEFAULT 1,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				common_name TEXT DEFAULT '',
				organization TEXT DEFAULT '',
				country TEXT DEFAULT '',
				state TEXT DEFAULT '',
				city TEXT DEFAULT '',
				dns_names TEXT DEFAULT '[]',
				ip_addresses TEXT DEFAULT '[]',
				last_notified_at DATETIME,
				ca_subject TEXT DEFAULT '',
				FOREIGN KEY (certificate_authority_id) REFERENCES certificate_authorities(id)
			)`,
			`INSERT INTO certificates_new (id, name, description, type, certificate_authority_id, current_version, created_at, updated_at, common_name, organization, country, state, city, dns_names, ip_addresses, last_notified_at, ca_subject)
			 SELECT id, name, description, type, certificate_authority_id, current_version, created_at, updated_at, COALESCE(common_name, ''), COALESCE(organization, ''), COALESCE(country, ''), COALESCE(state, ''), COALESCE(city, ''), COALESCE(dns_names, '[]'), COALESCE(ip_addresses, '[]'), last_notified_at, COALESCE(ca_subject, '') FROM certificates`,
			`DROP TABLE certificates`,
			`ALTER TABLE certificates_new RENAME TO certificates`,
		}
		for _, q := range migrateQueries {
			if _, txErr = tx.Exec(q); txErr != nil {
				tx.Rollback()
				return txErr
			}
		}
		if txErr = tx.Commit(); txErr != nil {
			return txErr
		}
	}

	groupAlterQueries := []string{
		`ALTER TABLE certificates ADD COLUMN group_name TEXT DEFAULT ''`,
	}

	for _, q := range groupAlterQueries {
		db.Exec(q)
	}

	db.Exec(`ALTER TABLE pending_sessions ADD COLUMN failed_attempts INTEGER DEFAULT 0`)

	// Insert default settings if not exists
	var count int
	err = db.QueryRow("SELECT COUNT(*) FROM settings").Scan(&count)
	if err != nil {
		return err
	}

	if count == 0 {
		_, err = db.Exec("INSERT INTO settings (id) VALUES (1)")
		if err != nil {
			return err
		}
	}

	return nil
}

func migrateToMultiUser(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Get admin data before migrating
	var adminEmail, adminPasswordHash string
	var adminTOTPSecret []byte
	var adminTOTPEnabled bool
	var adminCreatedAt string
	err = tx.QueryRow("SELECT email, password_hash, COALESCE(totp_secret, X''), totp_enabled, created_at FROM admin WHERE id = 1").Scan(
		&adminEmail, &adminPasswordHash, &adminTOTPSecret, &adminTOTPEnabled, &adminCreatedAt,
	)
	if err != nil {
		// No admin row found, nothing to migrate
		return nil
	}

	// Generate UUID for admin user
	var newUserID string
	err = tx.QueryRow("SELECT LOWER(HEX(RANDOMBLOB(4)) || '-' || HEX(RANDOMBLOB(2)) || '-4' || SUBSTR(HEX(RANDOMBLOB(2)),2) || '-' || HEX(RANDOMBLOB(2)) || '-' || HEX(RANDOMBLOB(6)))").Scan(&newUserID)
	if err != nil {
		return err
	}

	// Create users table
	_, err = tx.Exec(`CREATE TABLE IF NOT EXISTS users (
		id TEXT PRIMARY KEY,
		name TEXT DEFAULT '',
		email TEXT NOT NULL UNIQUE,
		password_hash TEXT NOT NULL,
		role TEXT NOT NULL DEFAULT 'operator' CHECK(role IN ('admin', 'operator', 'viewer')),
		totp_secret BLOB,
		totp_enabled BOOLEAN DEFAULT FALSE,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`)
	if err != nil {
		return err
	}

	// Insert admin as first user with 'admin' role
	_, err = tx.Exec(`INSERT INTO users (id, email, password_hash, totp_secret, totp_enabled, created_at, role)
		VALUES (?, ?, ?, ?, ?, ?, 'admin')`,
		newUserID, adminEmail, adminPasswordHash, adminTOTPSecret, adminTOTPEnabled, adminCreatedAt,
	)
	if err != nil {
		return err
	}

	// Migrate sessions: add user_id column
	var sessionsExists int
	tx.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='sessions'").Scan(&sessionsExists)
	if sessionsExists > 0 {
		// Check if user_id column already exists
		var hasUserID int
		tx.QueryRow("SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name='user_id'").Scan(&hasUserID)
		if hasUserID == 0 {
			// SQLite doesn't support adding FK via ALTER TABLE, so recreate
			_, err = tx.Exec(`CREATE TABLE sessions_new (
				token TEXT PRIMARY KEY,
				user_id TEXT NOT NULL,
				expires_at DATETIME NOT NULL,
				FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
			)`)
			if err != nil {
				return err
			}
			_, err = tx.Exec(`INSERT INTO sessions_new (token, user_id, expires_at)
				SELECT token, ?, expires_at FROM sessions`, newUserID)
			if err != nil {
				return err
			}
			_, err = tx.Exec(`DROP TABLE sessions`)
			if err != nil {
				return err
			}
			_, err = tx.Exec(`ALTER TABLE sessions_new RENAME TO sessions`)
			if err != nil {
				return err
			}
		}
	}

	// Migrate pending_sessions: add user_id column
	var pendingExists int
	tx.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='pending_sessions'").Scan(&pendingExists)
	if pendingExists > 0 {
		var hasUserID int
		tx.QueryRow("SELECT COUNT(*) FROM pragma_table_info('pending_sessions') WHERE name='user_id'").Scan(&hasUserID)
		if hasUserID == 0 {
			_, err = tx.Exec(`CREATE TABLE pending_sessions_new (
				token TEXT PRIMARY KEY,
				user_id TEXT NOT NULL,
				expires_at DATETIME NOT NULL,
				FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
			)`)
			if err != nil {
				return err
			}
			_, err = tx.Exec(`INSERT INTO pending_sessions_new (token, user_id, expires_at)
				SELECT token, ?, expires_at FROM pending_sessions`, newUserID)
			if err != nil {
				return err
			}
			_, err = tx.Exec(`DROP TABLE pending_sessions`)
			if err != nil {
				return err
			}
			_, err = tx.Exec(`ALTER TABLE pending_sessions_new RENAME TO pending_sessions`)
			if err != nil {
				return err
			}
		}
	}

	// Migrate backup_codes: add user_id column
	var backupCodesExists int
	tx.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='backup_codes'").Scan(&backupCodesExists)
	if backupCodesExists > 0 {
		var hasUserID int
		tx.QueryRow("SELECT COUNT(*) FROM pragma_table_info('backup_codes') WHERE name='user_id'").Scan(&hasUserID)
		if hasUserID == 0 {
			_, err = tx.Exec(`CREATE TABLE backup_codes_new (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				user_id TEXT NOT NULL,
				code_hash TEXT NOT NULL,
				used BOOLEAN DEFAULT FALSE,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
			)`)
			if err != nil {
				return err
			}
			_, err = tx.Exec(`INSERT INTO backup_codes_new (id, user_id, code_hash, used, created_at)
				SELECT id, ?, code_hash, used, created_at FROM backup_codes`, newUserID)
			if err != nil {
				return err
			}
			_, err = tx.Exec(`DROP TABLE backup_codes`)
			if err != nil {
				return err
			}
			_, err = tx.Exec(`ALTER TABLE backup_codes_new RENAME TO backup_codes`)
			if err != nil {
				return err
			}
		}
	}

	// Migrate settings: remove setup_complete, reset_token, reset_token_expires_at
	var settingsExists int
	tx.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='settings'").Scan(&settingsExists)
	if settingsExists > 0 {
		var hasSetupComplete int
		tx.QueryRow("SELECT COUNT(*) FROM pragma_table_info('settings') WHERE name='setup_complete'").Scan(&hasSetupComplete)
		if hasSetupComplete > 0 {
			// Recreate settings table without setup_complete, reset_token, reset_token_expires_at
			_, err = tx.Exec(`CREATE TABLE settings_new (
				id INTEGER PRIMARY KEY DEFAULT 1,
				organization TEXT DEFAULT '',
				country TEXT DEFAULT '',
				state TEXT DEFAULT '',
				city TEXT DEFAULT '',
				email TEXT DEFAULT '',
				default_key_algorithm TEXT DEFAULT 'rsa',
				default_rsa_key_size INTEGER DEFAULT 2048,
				default_ecdsa_curve TEXT DEFAULT 'P-256',
				default_validity_days INTEGER DEFAULT 365,
				notifications_enabled BOOLEAN DEFAULT 0,
				notification_webhook_url TEXT DEFAULT '',
				notification_threshold_days INTEGER DEFAULT 30,
				smtp_host TEXT DEFAULT '',
				smtp_port INTEGER DEFAULT 587,
				smtp_username TEXT DEFAULT '',
				smtp_password TEXT DEFAULT '',
				smtp_from_email TEXT DEFAULT '',
				smtp_from_name TEXT DEFAULT 'GLCert',
				email_notifications_enabled BOOLEAN DEFAULT 0,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
			)`)
			if err != nil {
				return err
			}
			_, err = tx.Exec(`INSERT INTO settings_new (id, organization, country, state, city, email,
				default_key_algorithm, default_rsa_key_size, default_ecdsa_curve, default_validity_days,
				notifications_enabled, notification_webhook_url, notification_threshold_days,
				smtp_host, smtp_port, smtp_username, smtp_password, smtp_from_email, smtp_from_name,
				email_notifications_enabled, created_at, updated_at)
				SELECT id, COALESCE(organization,''), COALESCE(country,''), COALESCE(state,''),
				COALESCE(city,''), COALESCE(email,''), COALESCE(default_key_algorithm,'rsa'),
				COALESCE(default_rsa_key_size,2048), COALESCE(default_ecdsa_curve,'P-256'),
				COALESCE(default_validity_days,365), COALESCE(notifications_enabled,0),
				COALESCE(notification_webhook_url,''), COALESCE(notification_threshold_days,30),
				COALESCE(smtp_host,''), COALESCE(smtp_port,587), COALESCE(smtp_username,''),
				COALESCE(smtp_password,''), COALESCE(smtp_from_email,''), COALESCE(smtp_from_name,'GLCert'),
				COALESCE(email_notifications_enabled,0), COALESCE(created_at, CURRENT_TIMESTAMP),
				COALESCE(updated_at, CURRENT_TIMESTAMP) FROM settings`)
			if err != nil {
				return err
			}
			_, err = tx.Exec(`DROP TABLE settings`)
			if err != nil {
				return err
			}
			_, err = tx.Exec(`ALTER TABLE settings_new RENAME TO settings`)
			if err != nil {
				return err
			}
		}
	}

	// Drop old admin table
	_, err = tx.Exec(`DROP TABLE admin`)
	if err != nil {
		return err
	}

	logger.Infof("Multi-user migration complete: admin user ID = %s", newUserID)
	return tx.Commit()
}

func containsString(s, substr string) bool {
	return len(s) >= len(substr) && searchString(s, substr)
}

func searchString(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
