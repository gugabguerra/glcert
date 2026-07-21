# GLCert - Technical Specifications

## Database Model

GLCert uses SQLite with 13 tables:

### users

Multi-user accounts with role-based access.

| Column        | Type          | Notes                                    |
| ------------- | ------------- | ---------------------------------------- |
| id            | TEXT PK       | UUID v4                                  |
| name          | TEXT          | Display name                             |
| email         | TEXT NOT NULL | UNIQUE, login ID                         |
| password_hash | TEXT NOT NULL | bcrypt                                   |
| role          | TEXT NOT NULL | CHECK: 'admin', 'operator', 'viewer'    |
| totp_secret   | BLOB          | AES-GCM encrypted, nullable              |
| totp_enabled  | BOOLEAN       | DEFAULT FALSE                            |
| created_at    | DATETIME      |                                          |

### settings

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
| smtp_host                    | TEXT       | ''       |
| smtp_port                    | INTEGER    | 587      |
| smtp_username                | TEXT       | ''       |
| smtp_password                | TEXT       | ''       |
| smtp_from_email              | TEXT       | ''       |
| smtp_from_name               | TEXT       | 'GLCert' |
| created_at                  | DATETIME   |          |
| updated_at                  | DATETIME   |          |

### sessions

Active user sessions. Cleared on server restart.

| Column     | Type           | Notes                      |
| ---------- | -------------- | -------------------------- |
| token      | TEXT PK        | Random hex token           |
| user_id    | TEXT NOT NULL  | FK -> users(id) ON DELETE CASCADE |
| expires_at | DATETIME       | NOT NULL, 24-hour expiry   |

### pending_sessions

Used during two-factor authentication flow. Stores temporary tokens for users who have authenticated with password but need to complete TOTP verification.

| Column     | Type           | Notes                          |
| ---------- | -------------- | ------------------------------ |
| token      | TEXT PK        | Random hex token               |
| user_id    | TEXT NOT NULL  | FK -> users(id) ON DELETE CASCADE |
| expires_at | DATETIME       | NOT NULL, 5-minute expiry      |

### backup_codes

Single-use backup codes for TOTP recovery. Stored as SHA-256 hashes.

| Column     | Type           | Notes                            |
| ---------- | -------------- | -------------------------------- |
| id         | INTEGER PK     | AUTOINCREMENT                    |
| user_id    | TEXT NOT NULL  | FK -> users(id) ON DELETE CASCADE |
| code_hash  | TEXT NOT NULL  | SHA-256 hash of backup code      |
| used       | BOOLEAN        | DEFAULT FALSE                    |
| created_at | DATETIME       | DEFAULT CURRENT_TIMESTAMP        |

### password_resets

Tokens for email-based password reset flow.

| Column     | Type           | Notes                            |
| ---------- | -------------- | -------------------------------- |
| id         | INTEGER PK     | AUTOINCREMENT                    |
| user_id    | TEXT NOT NULL  | FK -> users(id) ON DELETE CASCADE |
| token      | TEXT NOT NULL  | Random hex token                 |
| expires_at | DATETIME       | NOT NULL, 1-hour expiry          |

### ca_permissions

Per-CA access control for operators and viewers.

| Column  | Type          | Notes                            |
| ------- | ------------- | -------------------------------- |
| ca_id   | TEXT NOT NULL | FK -> certificate_authorities(id) ON DELETE CASCADE |
| user_id | TEXT NOT NULL | FK -> users(id) ON DELETE CASCADE |

Composite primary key on (ca_id, user_id).

### audit_log

Immutable audit trail of all administrative and certificate operations.

| Column      | Type           | Notes              |
| ----------- | -------------- | ------------------ |
| id          | INTEGER PK     | AUTOINCREMENT      |
| user_id     | TEXT           | nullable           |
| user_email  | TEXT           | nullable, snapshot |
| action      | TEXT NOT NULL  | e.g. 'ca.create', 'certificate.delete', 'user.create', 'settings.update' |
| entity_type | TEXT           | e.g. 'ca', 'certificate', 'user' |
| entity_id   | TEXT           | UUID of entity     |
| details     | TEXT           | Free-text description |
| created_at  | DATETIME       |                    |

### certificate_authorities

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

### certificates

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

### certificate_versions

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

### share_links

| Column      | Type                 | Notes                                          |
| ----------- | -------------------- | ---------------------------------------------- |
| id          | INTEGER PK           | AUTOINCREMENT                                  |
| token       | TEXT UNIQUE NOT NULL | 32-char hex                                    |
| entity_type | TEXT NOT NULL        | CHECK: 'certificate', 'ca'                     |
| entity_id   | TEXT NOT NULL        | UUID of entity                                 |
| file_type   | TEXT                 | 'certificate', 'key', 'ca', 'bundle_zip', 'bundle_tgz' |
| expires_at  | DATETIME NOT NULL    | 15 minutes                                     |
| created_at  | DATETIME             |                                                |

### Entity Relationships

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

## API Reference

### Public Routes (no auth)

| Method | Route                      | Description                    |
| ------ | -------------------------- | ------------------------------ |
| GET    | /api/health                | Health check                   |
| GET    | /api/auth/status           | Check if setup is complete     |
| POST   | /api/auth/setup            | Create admin account           |
| POST   | /api/auth/login            | Login (returns token + user)   |
| POST   | /api/auth/forgot-password  | Request password reset email   |
| POST   | /api/auth/reset-password   | Reset password with token      |
| POST   | /api/totp/verify           | Verify TOTP code (during login)|
| POST   | /api/backup/restore        | Restore from encrypted backup  |
| GET    | /api/share/{token}         | Download bundle via share link |

### Protected Routes -- Any Role

| Method | Route                    | Description              |
| ------ | ------------------------ | ------------------------ |
| POST   | /api/auth/logout         | Logout                   |
| PUT    | /api/auth/password       | Change own password      |
| GET    | /api/totp/status         | Get TOTP status          |
| GET    | /api/totp/setup          | Generate TOTP secret + QR |
| POST   | /api/totp/verify-setup   | Verify and enable TOTP   |
| POST   | /api/totp/disable        | Disable TOTP             |
| GET    | /api/users/me            | Get current user profile |
| PUT    | /api/users/me            | Update current user name |
| GET    | /api/dashboard           | Dashboard stats          |
| POST   | /api/notifications/test  | Send test notification   |
| POST   | /api/notifications/test-email | Send test email     |
| POST   | /api/share/{type}/{id}   | Generate share link      |
| POST   | /api/share/send-email    | Send share link via email |
| GET    | /api/ca                  | List CAs (filtered by permissions for non-admins) |
| GET    | /api/ca/{id}             | Get CA                   |
| GET    | /api/ca/{id}/download/cert | Download CA cert       |
| GET    | /api/ca/{id}/download/key  | Download CA key        |
| GET    | /api/ca/{id}/download/bundle | Download CA bundle    |
| GET    | /api/certificates        | List certificates (filtered by permissions for non-admins) |
| GET    | /api/certificates/groups | List certificate groups  |
| GET    | /api/certificates/download/group | Download group as ZIP |
| GET    | /api/certificates/{id}   | Get certificate          |
| GET    | /api/certificates/{id}/versions | List versions        |
| GET    | /api/certificates/{id}/download/cert | Download cert PEM |
| GET    | /api/certificates/{id}/download/key | Download key PEM  |
| GET    | /api/certificates/{id}/download/ca  | Download CA PEM   |
| GET    | /api/certificates/{id}/download/bundle | Download bundle (ZIP/TGZ) |

### Protected Routes -- Operator + Admin

| Method | Route                                             | Description            |
| ------ | ------------------------------------------------- | ---------------------- |
| POST   | /api/ca                                           | Create CA              |
| POST   | /api/ca/import                                    | Import external CA     |
| DELETE | /api/ca/{id}                                      | Delete CA              |
| POST   | /api/certificates                                 | Create certificate     |
| POST   | /api/certificates/import                          | Import certificate     |
| PATCH  | /api/certificates/{id}                            | Update certificate group |
| POST   | /api/certificates/{id}/regenerate                 | Regenerate certificate |
| POST   | /api/certificates/{id}/versions/{version}/restore | Restore version        |
| DELETE | /api/certificates/{id}/versions/{version}         | Delete version         |
| DELETE | /api/certificates/{id}                            | Delete certificate     |

### Protected Routes -- Admin Only

| Method | Route                              | Description                  |
| ------ | ---------------------------------- | ---------------------------- |
| GET    | /api/settings                      | Get settings                 |
| PUT    | /api/settings                      | Update settings              |
| POST   | /api/admin/factory-reset           | Delete all data              |
| POST   | /api/backup/create                 | Create backup                |
| GET    | /api/users                         | List all users               |
| POST   | /api/users                         | Create new user              |
| PUT    | /api/users/{id}                    | Update user name/role        |
| POST   | /api/users/{id}/reset-password     | Admin reset user password    |
| DELETE | /api/users/{id}                    | Delete user                  |
| GET    | /api/ca/{id}/permissions           | Get CA permission assignments |
| PUT    | /api/ca/{id}/permissions           | Set CA permission assignments |
| GET    | /api/audit                         | List audit log entries       |

## Project Structure

```
glcert/
  backend/
    cmd/server/main.go          Entry point, routes, scheduler
    internal/
      backup/
        backup.go               Backup/restore with encrypted ZIP
      config/
        config.go               Environment variable loading
      database/
        database.go             SQLite connection
        migrations.go           Schema creation and multi-user migrations
      handlers/
        admin.go                Factory reset
        auth.go                 Login, setup, logout, password, forgot/reset
        audit.go                Audit log list endpoint
        backup.go               Backup create/restore endpoints
        bundle.go               Shared ZIP/TGZ bundle writer
        ca.go                   CA CRUD, downloads, import, permission filtering
        ca_permission.go        CA permission get/set endpoints
        cert.go                 Certificate CRUD, versions, downloads, permission filtering
        handlers.go             Settings and dashboard
        middleware.go           Auth middleware, RequireRole, GetUserID, GetUserRole
        notification.go         Test notification endpoint
        share.go                Temporary link generation, serving, email
        static.go               SPA file server
        totp.go                 TOTP setup, verify, disable endpoints (user-scoped)
        user.go                 User CRUD, admin password reset, profile
      logger/
        logger.go               Leveled logger (DEBUG/INFO/WARN/ERROR/FATAL), LOG_LEVEL env var
      models/models.go          Domain models (User, CertificateAuthority, Certificate, etc.)
      services/
        auth.go                 User management, session management, CA permissions, admin password reset
        audit.go                Audit log write and query
        ca.go                   CA creation, import, encryption, file I/O
        cert.go                 Certificate creation, encryption, file I/O
        crypto.go               AES-GCM encryption for keys at rest
        email.go                SMTP client for password reset and alerts
        notification.go         Shoutrrr integration, expiration checker
        totp.go                 TOTP secret generation, validation, backup codes (user-scoped)
    go.mod
  frontend/
    src/
      api.ts                    API utilities (authFetch, downloadFile)
      auth.tsx                  Auth context with User interface, hasRole(), localStorage persistence
      App.tsx                   Routes, role-based nav, AdminRoute/OperatorRoute/ViewerRoute guards
      main.tsx                  Mantine provider, theme config
      components/
        PasswordStrengthIndicator.tsx   Visual password strength meter
      utils/
        password.ts              Password scoring logic (weak/fair/good/strong)
      pages/
        Login.tsx               Login with credentials + TOTP
        ForgotPassword.tsx      Password reset request form
        ResetPassword.tsx       New password form (via token)
        Setup.tsx               3-step setup wizard
        Dashboard.tsx           Stats cards (admin/operator only)
        Settings.tsx            Certificate defaults, notifications, email (admin only)
        Administration.tsx      Users, audit log, danger zone (admin only, tabbed layout)
        UserProfile.tsx         Appearance, security (password + TOTP), sign out
        CertificateAuthorities.tsx  CA list with tree view
        CreateCA.tsx            CA creation form (admin only)
        ImportCA.tsx            Import external CA (admin only)
        CADetail.tsx            CA detail, downloads, share link, access control (admin only)
        Certificates.tsx        Certificate list with tree view and filters
        CreateCertificate.tsx   Certificate creation form
        ImportCertificate.tsx   Import certificate
        CertificateDetail.tsx   Certificate detail, versions, share link, editable groups
    package.json
    vite.config.ts
  Dockerfile                    Multi-stage Docker build
  docker-compose.yml            Docker Compose config
```

## Audit Log Actions

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
