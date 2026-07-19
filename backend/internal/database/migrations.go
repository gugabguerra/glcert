package database

import (
	"database/sql"
	"log"
)

func migrate(db *sql.DB) error {
	// Detect old schema (integer PKs) and drop for clean break
	var idType string
	err := db.QueryRow("SELECT type FROM pragma_table_info('certificate_authorities') WHERE name = 'id'").Scan(&idType)
	if err == nil && idType == "INTEGER" {
		log.Println("[migration] detected old integer PK schema — dropping tables for UUID migration")
		dropTables := []string{"certificate_versions", "certificates", "certificate_authorities", "share_links"}
		for _, t := range dropTables {
			db.Exec("DROP TABLE IF EXISTS " + t)
		}
	}

	queries := []string{
		`CREATE TABLE IF NOT EXISTS admin (
			id INTEGER PRIMARY KEY DEFAULT 1,
			email TEXT NOT NULL,
			password_hash TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS settings (
			id INTEGER PRIMARY KEY DEFAULT 1,
			setup_complete BOOLEAN DEFAULT FALSE,
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
			type TEXT NOT NULL CHECK(type IN ('server', 'client', 'selfsigned')),
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

	// Add columns that may be missing from older schemas
	alterQueries := []string{
		`ALTER TABLE certificates ADD COLUMN common_name TEXT DEFAULT ''`,
		`ALTER TABLE certificates ADD COLUMN organization TEXT DEFAULT ''`,
		`ALTER TABLE certificates ADD COLUMN country TEXT DEFAULT ''`,
		`ALTER TABLE certificates ADD COLUMN state TEXT DEFAULT ''`,
		`ALTER TABLE certificates ADD COLUMN city TEXT DEFAULT ''`,
		`ALTER TABLE certificates ADD COLUMN dns_names TEXT DEFAULT '[]'`,
		`ALTER TABLE certificates ADD COLUMN ip_addresses TEXT DEFAULT '[]'`,
		`ALTER TABLE settings ADD COLUMN setup_complete BOOLEAN DEFAULT FALSE`,
		`ALTER TABLE settings ADD COLUMN organization TEXT DEFAULT ''`,
		`ALTER TABLE settings ADD COLUMN country TEXT DEFAULT ''`,
		`ALTER TABLE settings ADD COLUMN state TEXT DEFAULT ''`,
		`ALTER TABLE settings ADD COLUMN city TEXT DEFAULT ''`,
		`ALTER TABLE settings ADD COLUMN email TEXT DEFAULT ''`,
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
		`ALTER TABLE settings ADD COLUMN reset_token TEXT DEFAULT ''`,
		`ALTER TABLE settings ADD COLUMN reset_token_expires_at DATETIME`,
	}

	for _, q := range smtpAlterQueries {
		db.Exec(q)
	}

	passphraseAlterQueries := []string{
		`ALTER TABLE certificate_authorities ADD COLUMN key_encrypted_passphrase BLOB`,
		`ALTER TABLE certificate_authorities ADD COLUMN imported BOOLEAN DEFAULT FALSE`,
	}

	for _, q := range passphraseAlterQueries {
		db.Exec(q)
	}

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
