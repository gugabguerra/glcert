# GLCert - Technical Specifications

## Database Model

GLCert uses SQLite with 7 tables:

### admin

Singleton table storing the admin account.

| Column        | Type          | Notes    |
| ------------- | ------------- | -------- |
| id            | INTEGER PK    | Always 1 |
| email         | TEXT NOT NULL | Login ID |
| password_hash | TEXT NOT NULL | bcrypt   |
| created_at    | DATETIME      |          |

### settings

Singleton table storing application configuration.

| Column                      | Type       | Default  |
| --------------------------- | ---------- | -------- |
| id                          | INTEGER PK | Always 1 |
| setup_complete              | BOOLEAN    | FALSE    |
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

### certificates

| Column                   | Type          | Notes                                       |
| ------------------------ | ------------- | ------------------------------------------- |
| id                       | TEXT PK       | UUID v4                                     |
| name                     | TEXT NOT NULL |                                             |
| description              | TEXT          | DEFAULT ''                                  |
| type                     | TEXT NOT NULL | CHECK: 'server', 'client', 'selfsigned'     |
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
admin (singleton)
settings (singleton)

certificate_authorities 1 --< certificates
certificates 1 --< certificate_versions
certificate_authorities 1 --< share_links (entity_type='ca')
certificates 1 --< share_links (entity_type='certificate')
```

## API Reference

### Public Routes (no auth)

| Method | Route                    | Description                    |
| ------ | ------------------------ | ------------------------------ |
| GET    | /api/health              | Health check                   |
| GET    | /api/auth/status         | Check if setup is complete     |
| POST   | /api/auth/setup          | Create admin account           |
| POST   | /api/auth/login          | Login                          |
| POST   | /api/auth/forgot-password | Request password reset email  |
| POST   | /api/auth/reset-password | Reset password with token      |
| GET    | /api/share/{token}       | Download bundle via share link |

### Protected Routes (Bearer token required)

| Method | Route                                             | Description            |
| ------ | ------------------------------------------------- | ---------------------- |
| POST   | /api/auth/logout                                  | Logout                 |
| PUT    | /api/auth/password                                | Change admin password  |
| POST   | /api/admin/factory-reset                          | Delete all data        |
| GET    | /api/dashboard                                    | Dashboard stats        |
| GET    | /api/settings                                     | Get settings           |
| PUT    | /api/settings                                     | Update settings        |
| POST   | /api/notifications/test                           | Send test notification |
| POST   | /api/share/{type}/{id}                            | Generate share link    |
| GET    | /api/ca                                           | List CAs               |
| POST   | /api/ca                                           | Create CA              |
| POST   | /api/ca/import                                    | Import external CA     |
| GET    | /api/ca/{id}                                      | Get CA                 |
| DELETE | /api/ca/{id}                                      | Delete CA              |
| GET    | /api/ca/{id}/download/cert                        | Download CA cert       |
| GET    | /api/ca/{id}/download/key                         | Download CA key        |
| GET    | /api/ca/{id}/download/bundle                      | Download CA bundle     |
| GET    | /api/certificates                                 | List certificates      |
| POST   | /api/certificates                                 | Create certificate     |
| GET    | /api/certificates/{id}                            | Get certificate        |
| GET    | /api/certificates/{id}/versions                   | List versions          |
| POST   | /api/certificates/{id}/regenerate                 | Regenerate certificate |
| POST   | /api/certificates/{id}/versions/{version}/restore | Restore version        |
| DELETE | /api/certificates/{id}/versions/{version}         | Delete version         |
| DELETE | /api/certificates/{id}                            | Delete certificate     |
| GET    | /api/certificates/{id}/download/cert              | Download cert PEM      |
| GET    | /api/certificates/{id}/download/key               | Download key PEM       |
| GET    | /api/certificates/{id}/download/ca                | Download CA PEM        |
| GET    | /api/certificates/{id}/download/bundle            | Download ZIP bundle    |

## Project Structure

```
glcert/
  backend/
    cmd/server/main.go          Entry point, routes, scheduler
    internal/
      config/config.go          Environment variable loading
      database/
        database.go             SQLite connection
        migrations.go           Schema creation and migrations
      handlers/
        auth.go                 Login, setup, logout, password, forgot/reset
        bundle.go               Shared ZIP/TGZ bundle writer
        ca.go                   CA CRUD, downloads, and import
        cert.go                 Certificate CRUD, versions, downloads
        handlers.go             Settings and dashboard
        middleware.go           Auth middleware (Bearer token)
        notification.go         Test notification endpoint
        share.go                Temporary link generation and serving
        static.go               SPA file server
      models/models.go          Domain models
      services/
        auth.go                 bcrypt, session management, reset tokens
        ca.go                   CA creation, import, encryption, file I/O
        cert.go                 Certificate creation, encryption, file I/O
        crypto.go               AES-GCM encryption for keys at rest
        email.go                SMTP client for password reset and alerts
        notification.go         Shoutrrr integration, expiration checker
    go.mod
  frontend/
    src/
      api.ts                    API utilities (authFetch, downloadFile)
      auth.tsx                  Auth context and provider
      App.tsx                   Routes, layout, mobile menu
      main.tsx                  Mantine provider, theme config
      pages/
        Login.tsx               Login form (email-based)
        ForgotPassword.tsx      Password reset request form
        ResetPassword.tsx       New password form (via token)
        Setup.tsx               3-step setup wizard
        Dashboard.tsx           Stats cards
        Settings.tsx            Certificate defaults, appearance, notifications, email, security
        CertificateAuthorities.tsx  CA list
        CreateCA.tsx            CA creation form
        ImportCA.tsx            Import external CA
        CADetail.tsx            CA detail, downloads, share link
        Certificates.tsx        Certificate list with filters
        CreateCertificate.tsx   Certificate creation form
        CertificateDetail.tsx   Certificate detail, versions, share link
    package.json
    vite.config.ts
  Dockerfile                    Multi-stage Docker build
  docker-compose.yml            Docker Compose config
```
