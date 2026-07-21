# GLCert

Self-hosted PKI manager for lab and private environments. Generate and manage TLS certificates without using OpenSSL.

For technical details (database schema, API reference, project structure), see [TECH.md](TECH.md).

## Features

- **Multi-User Support** -- Admin, Operator, and Viewer roles. Admins manage users and system settings. Operators create and manage certificates under assigned CAs. Viewers have read-only access with share link capabilities.
- **Role-Based Access Control** -- Per-CA permission assignment. Operators only see CAs they have been granted access to (including child CAs via automatic chain traversal).
- **Administration Panel** -- Centralized admin page with user management, audit log, and system operations (backup, restore, factory reset).
- **User Management** -- Create users with role assignment and CA access. Admins can reset passwords and change roles. Password strength indicator on all password fields.
- **Audit Log** -- Track all system activity: CA/certificate operations, user changes, settings updates, logins. Filterable by action type.
- **CA Management** -- Create or import certificate authorities with RSA, ECDSA, or Ed25519 keys. Support for passphrase-protected private keys (PKCS#8 and legacy PEM). Create intermediate CAs signed by a parent CA with automatic chain management. Download CA certificates and private keys individually or as ZIP bundles.
- **Certificate Management** -- Generate server, client, server+client, or self-signed certificates. Regenerate with custom validity periods. Full version history with restore capability.
- **Download Bundles** -- Download certificates, private keys, CA certs, or complete ZIP/TGZ bundles with a single click.
- **Temporary Share Links** -- Generate time-limited, single-use URLs for sharing certificates, keys, or bundles via wget/curl. Send share links via email. No authentication required for the download link.
- **MFA / TOTP** -- Two-factor authentication with QR code setup, 6-digit TOTP codes, and single-use backup codes. Encrypted secret storage at rest.
- **Backup & Restore** -- Password-encrypted ZIP backup of all data. Restore merges into existing data without overwriting.
- **Email Integration** -- SMTP support for password reset and expiration alerts. Configure in Settings with a test button.
- **Expiration Notifications** -- Get notified via Discord, Slack, Telegram, email (SMTP), or 20+ other services when certificates or CAs are close to expiration. Configurable threshold and webhook URL.
- **Dashboard** -- Overview of all CAs, certificates, expiring soon, and expired counts. Visible to admin and operator roles.
- **Dark / Light / System Theme** -- Full theme support with instant switching.
- **Responsive Design** -- Mobile-friendly with hamburger menu on small screens.
- **Password Reset** -- Forgot your password? Reset via email link (requires SMTP configured).
- **Setup Wizard** -- Guided initial setup for admin credentials and encryption passphrase.
- **Factory Reset** -- Complete data wipe with confirmation dialog (admin only).

## Role Permissions

| Action | Admin | Operator | Viewer |
|--------|:-----:|:--------:|:------:|
| View Dashboard | Yes | Yes | No |
| View / Download CAs | Yes | Assigned CAs | No |
| View / Download Certificates | Yes | Assigned CAs | Yes (shared) |
| Create / Delete CAs | Yes | No | No |
| Import CAs | Yes | No | No |
| Create / Delete Certificates | Yes | Assigned CAs | No |
| Manage Users | Yes | No | No |
| View Audit Log | Yes | No | No |
| Backup / Restore / Factory Reset | Yes | No | No |
| System Settings | Yes | No | No |
| Create Share Links | Yes | Yes | Yes |

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Go 1.24, Chi router, crypto/x509 |
| Frontend | React 19, TypeScript, Mantine UI v9, Vite |
| Database | SQLite (pure-Go driver, no CGO required) |
| Notifications | Shoutrrr (nicholas-fedor/shoutrrr v0.16.1) |
| Deployment | Docker (multi-stage build), Docker Compose |

## Getting Started

### Prerequisites

- Go 1.24+
- Node.js 20+
- npm

### Local Development

**Backend:**

```bash
cd backend
go mod download
go run ./cmd/server
```

The server starts on `http://localhost:8080`.

**Frontend:**

```bash
cd frontend
npm install
npm run dev
```

The dev server starts on `http://localhost:5173` with proxy to the backend.

### Docker Deployment

```bash
docker compose up -d
```

This builds and runs the application on port 8080 with a persistent Docker volume for data.

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | HTTP server listen port |
| `DATA_DIR` | `./data` | Root directory for database and certificate storage |
| `LOG_LEVEL` | `info` | Log verbosity: `debug`, `info`, `warn`, `error`, `fatal` |

## Notifications

GLCert can notify you when certificates or CAs are close to expiration via webhooks. Supported services include Discord, Slack, Telegram, email (SMTP), and 20+ others via [Shoutrrr](https://shoutrrr.nickfedor.com/).

### Discord Setup

1. In your Discord server, go to **Server Settings > Integrations > Webhooks**
2. Click **New Webhook**, name it, choose the channel, and copy the URL
3. Convert the URL to Shoutrrr format: `discord://token@webhookid`
   - From `https://discord.com/api/webhooks/WEBHOOK_ID/TOKEN`, extract the token (after last `/`) and the webhook ID (the number before the last `/`)
4. In GLCert, go to **Settings > Notifications**
5. Paste the URL, set your preferred threshold (default 30 days), and enable
6. Click **Send Test Notification** to verify

### Other Services

| Service | URL Format |
|---|---|
| Slack | `slack://token-a/token-b/token-c` |
| Telegram | `telegram://token@telegram?chats=@channel` |
| Email | `smtp://user:pass@host:port/?from=addr&to=recipient` |
| Gotify | `gotify://host/token` |

Alternatively, configure built-in SMTP in Settings for password reset and email alerts without a webhook URL.

See the full list at [shoutrrr.nickfedor.com](https://shoutrrr.nickfedor.com/services/overview/).

## Security

- **Multi-user access control** -- Role-based permissions with per-CA access assignment for operators
- **Encryption at rest** -- Private keys are encrypted using AES-256-GCM before being stored on disk
- **Key derivation** -- The encryption passphrase is derived from the admin password using PBKDF2 with SHA-256
- **Session management** -- Random hex tokens with 24-hour expiry, 30-minute idle timeout, and global session clearing on server restart
- **MFA / TOTP** -- Optional two-factor authentication with encrypted secret storage and single-use backup codes
- **Share links** -- Single-use, 15-minute expiry, cryptographically random 32-char tokens
- **Password hashing** -- bcrypt with automatic salting
- **Password strength enforcement** -- Visual strength indicator with minimum length requirements
- **Password manager prevention** -- All form inputs configured to disable browser autofill
- **Audit trail** -- All administrative and certificate operations are logged with user attribution

## License

MIT
