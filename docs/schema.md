# Database schema

Everything lives in one SQLite database (`data/database.sqlite`) via a pure-Go driver (no CGO).
Schema creation and multi-user migrations run in `backend/internal/database/migrations.go`.
Sensitive material is never stored in the clear: passwords are bcrypt hashes, TOTP secrets and
key passphrases are AES-GCM blobs, and private keys live on disk encrypted (see
`docs/architecture.md`).

12 tables.

## users

Multi-user accounts with role-based access.

| Column        | Type          | Notes                                    |
| ------------- | ------------- | ---------------------------------------- |
| id            | TEXT PK       | UUID v4                                  |
| name          | TEXT          | Display name                             |
| email         | TEXT NOT NULL | UNIQUE, login ID                         |
| password_hash | TEXT NOT NULL | bcrypt                                   |
| role          | TEXT NOT NULL | CHECK: 'admin', 'operator', 'viewer'     |
| totp_secret   | BLOB          | AES-GCM encrypted, nullable              |
| totp_enabled  | BOOLEAN       | DEFAULT FALSE                            |
| created_at    | DATETIME      |                                          |

## settings

Singleton table storing application configuration.

| Column                      | Type       | Default  |
| --------------------------- | ---------- | -------- |
| id                          | INTEGER PK | Always 1 |
| organization                | TEXT       | ''       |
| country                     | TEXT       | ''       |
| state                       | TEXT       | ''       |
| city                        | TEXT       | ''       |
| email                       | TEXT       | ''       |
| default_key_algorithm       | TEXT       | 'rsa'    |
| default_rsa_key_size        | INTEGER    | 2048     |
| default_ecdsa_curve         | TEXT       | 'P-256'  |
| default_validity_days       | INTEGER    | 365      |
| notifications_enabled       | BOOLEAN    | 0        |
| notification_webhook_url    | TEXT       | ''       |
| notification_threshold_days | INTEGER    | 30       |
| email_notifications_enabled | BOOLEAN    | 0        |
| smtp_host                   | TEXT       | ''       |
| smtp_port                   | INTEGER    | 587      |
| smtp_username               | TEXT       | ''       |
| smtp_password               | TEXT       | ''       |
| smtp_from_email             | TEXT       | ''       |
| smtp_from_name              | TEXT       | 'GLCert' |
| created_at                  | DATETIME   |          |
| updated_at                  | DATETIME   |          |

## sessions

Active user sessions. Cleared on server restart.

| Column     | Type           | Notes                      |
| ---------- | -------------- | -------------------------- |
| token      | TEXT PK        | Random hex token           |
| user_id    | TEXT NOT NULL  | FK -> users(id) ON DELETE CASCADE |
| expires_at | DATETIME       | NOT NULL, 24-hour expiry   |

## pending_sessions

Temporary tokens during the two-factor login flow: password accepted, TOTP not yet verified.

| Column     | Type           | Notes                          |
| ---------- | -------------- | ------------------------------ |
| token      | TEXT PK        | Random hex token               |
| user_id    | TEXT NOT NULL  | FK -> users(id) ON DELETE CASCADE |
| expires_at | DATETIME       | NOT NULL, 5-minute expiry      |

## backup_codes

Single-use backup codes for TOTP recovery. Stored as SHA-256 hashes.

| Column     | Type           | Notes                            |
| ---------- | -------------- | -------------------------------- |
| id         | INTEGER PK     | AUTOINCREMENT                    |
| user_id    | TEXT NOT NULL  | FK -> users(id) ON DELETE CASCADE |
| code_hash  | TEXT NOT NULL  | SHA-256 hash of backup code      |
| used       | BOOLEAN        | DEFAULT FALSE                    |
| created_at | DATETIME       | DEFAULT CURRENT_TIMESTAMP        |

## password_resets

Tokens for the email-based password reset flow.

| Column     | Type           | Notes                            |
| ---------- | -------------- | -------------------------------- |
| id         | INTEGER PK     | AUTOINCREMENT                    |
| user_id    | TEXT NOT NULL  | FK -> users(id) ON DELETE CASCADE |
| token      | TEXT NOT NULL  | Random hex token                 |
| expires_at | DATETIME       | NOT NULL, 1-hour expiry          |

## ca_permissions

Per-CA access control for operators and viewers.

| Column  | Type          | Notes                            |
| ------- | ------------- | -------------------------------- |
| ca_id   | TEXT NOT NULL | FK -> certificate_authorities(id) ON DELETE CASCADE |
| user_id | TEXT NOT NULL | FK -> users(id) ON DELETE CASCADE |

Composite primary key on (ca_id, user_id).

## audit_log

Immutable audit trail of all administrative and certificate operations.

| Column      | Type           | Notes              |
| ----------- | -------------- | ------------------ |
| id          | INTEGER PK     | AUTOINCREMENT      |
| user_id     | TEXT           | nullable           |
| user_email  | TEXT           | nullable, snapshot |
| action      | TEXT NOT NULL  | see [Actions](#actions) |
| entity_type | TEXT           | e.g. 'ca', 'certificate', 'user' |
| entity_id   | TEXT           | UUID of entity     |
| details     | TEXT           | Free-text description |
| created_at  | DATETIME       |                    |

## certificate_authorities

| Column                     | Type              | Notes                     |
| -------------------------- | ----------------- | ------------------------- |
| id                         | TEXT PK           | UUID v4                   |
| name                       | TEXT NOT NULL     |                           |
| description                | TEXT              | DEFAULT ''                |
| subject                    | TEXT NOT NULL     | X.509 subject             |
| created_at                 | DATETIME          |                           |
| expires_at                 | DATETIME NOT NULL |                           |
| current_version            | INTEGER           | DEFAULT 1                 |
| last_notified_at           | DATETIME          | nullable                  |
| key_encrypted_passphrase   | BLOB              | AES-GCM encrypted, nullable |
| imported                   | BOOLEAN           | DEFAULT FALSE             |
| parent_ca_id               | TEXT              | FK -> certificate_authorities(id), nullable. NULL = Root CA |

## certificates

| Column                   | Type          | Notes                                       |
| ------------------------ | ------------- | ------------------------------------------- |
| id                       | TEXT PK       | UUID v4                                     |
| name                     | TEXT NOT NULL |                                             |
| description              | TEXT          | DEFAULT ''                                  |
| type                     | TEXT NOT NULL | CHECK: 'server', 'client', 'serverclient', 'selfsigned' |
| certificate_authority_id | TEXT          | FK -> certificate_authorities(id), nullable |
| current_version          | INTEGER       | DEFAULT 1                                   |
| common_name              | TEXT          | DEFAULT ''                                  |
| organization             | TEXT          | DEFAULT ''                                  |
| country                  | TEXT          | DEFAULT ''                                  |
| state                    | TEXT          | DEFAULT ''                                  |
| city                     | TEXT          | DEFAULT ''                                  |
| dns_names                | TEXT          | JSON array, DEFAULT '[]'                    |
| ip_addresses             | TEXT          | JSON array, DEFAULT '[]'                    |
| ca_subject               | TEXT          | Snapshot of CA subject at creation, DEFAULT '' |
| created_at               | DATETIME      |                                             |
| updated_at               | DATETIME      |                                             |
| last_notified_at         | DATETIME      | nullable                                    |
| group_name               | TEXT          | DEFAULT ''                                  |

## certificate_versions

| Column               | Type              | Notes                                    |
| -------------------- | ----------------- | ---------------------------------------- |
| id                   | INTEGER PK        | AUTOINCREMENT                            |
| certificate_id       | TEXT NOT NULL     | FK -> certificates(id) ON DELETE CASCADE |
| version              | INTEGER NOT NULL  |                                          |
| storage_path         | TEXT NOT NULL     | Filesystem path                          |
| serial_number        | TEXT NOT NULL     |                                          |
| fingerprint          | TEXT NOT NULL     |                                          |
| signature_algorithm  | TEXT NOT NULL     |                                          |
| public_key_algorithm | TEXT NOT NULL     |                                          |
| created_at           | DATETIME          |                                          |
| expires_at           | DATETIME NOT NULL |                                          |
| revoked              | BOOLEAN           | DEFAULT FALSE                            |

## share_links

| Column      | Type                 | Notes                                          |
| ----------- | -------------------- | ---------------------------------------------- |
| id          | INTEGER PK           | AUTOINCREMENT                                  |
| token       | TEXT UNIQUE NOT NULL | 32-char hex                                    |
| entity_type | TEXT NOT NULL        | CHECK: 'certificate', 'ca'                     |
| entity_id   | TEXT NOT NULL        | UUID of entity                                 |
| file_type   | TEXT                 | 'certificate', 'key', 'ca', 'bundle_zip', 'bundle_tgz' |
| expires_at  | DATETIME NOT NULL    | 15 minutes                                     |
| created_at  | DATETIME             |                                                |

## Relationships

```
users 1 --< sessions (user_id, ON DELETE CASCADE)
users 1 --< pending_sessions (user_id, ON DELETE CASCADE)
users 1 --< backup_codes (user_id, ON DELETE CASCADE)
users 1 --< password_resets (user_id, ON DELETE CASCADE)
users 1 --< ca_permissions (user_id, ON DELETE CASCADE)
users 1 --< audit_log (user_id, nullable)

certificate_authorities 1 --< certificates
certificate_authorities 1 --< certificate_authorities (parent_ca_id, for intermediate CAs)
certificate_authorities 1 --< ca_permissions (ca_id, ON DELETE CASCADE)
certificates 1 --< certificate_versions
certificate_authorities 1 --< share_links (entity_type='ca')
certificates 1 --< share_links (entity_type='certificate')
```

## Actions

Audit `action` values:

| Action                  | Description                        |
| ----------------------- | ---------------------------------- |
| ca.create               | CA created                         |
| ca.delete               | CA deleted                         |
| ca.import               | CA imported                        |
| ca.permissions.update   | CA access permissions changed      |
| certificate.create      | Certificate created                |
| certificate.delete      | Certificate deleted                |
| certificate.regenerate  | Certificate regenerated            |
| certificate.import      | Certificate imported               |
| user.create             | User account created               |
| user.delete             | User account deleted               |
| user.role_change        | User role changed                  |
| user.password_reset     | Admin reset user password          |
| settings.update         | System settings modified           |
| factory_reset           | Factory reset performed            |
| backup.create           | Backup created                     |
| backup.restore          | Backup restored                    |
