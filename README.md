# GLCert

Self-hosted PKI manager for homelab environments. Generate and manage TLS certificates without using OpenSSL.

For technical details (database schema, API reference, project structure), see [TECH.md](TECH.md).

## Features

- **CA Management** -- Create certificate authorities with RSA, ECDSA, or Ed25519 keys. Download CA certificates and private keys individually or as ZIP bundles.
- **Certificate Management** -- Generate server, client, or self-signed certificates. Regenerate with custom validity periods. Full version history with restore capability.
- **Download Bundles** -- Download certificates, private keys, CA certs, or complete ZIP bundles with a single click.
- **Temporary Share Links** -- Generate time-limited, single-use URLs for downloading certificate bundles to target machines via wget/curl. No authentication required for the download link.
- **Expiration Notifications** -- Get notified via Discord, Slack, Telegram, email, or 20+ other services when certificates or CAs are close to expiration. Configurable threshold and webhook URL.
- **Dashboard** -- Overview of all CAs, certificates, expiring soon, and expired counts.
- **Dark / Light / System Theme** -- Full theme support with instant switching.
- **Responsive Design** -- Mobile-friendly with hamburger menu on small screens.
- **Setup Wizard** -- Guided initial setup for admin credentials.
- **Factory Reset** -- Complete data wipe with confirmation dialog.

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Go 1.24, Chi router, crypto/x509 |
| Frontend | React 18, TypeScript, Mantine UI v7, Vite |
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

See the full list at [shoutrrr.nickfedor.com](https://shoutrrr.nickfedor.com/services/overview/).

## Security

- **Encryption at rest** -- Private keys are encrypted using AES-256-GCM before being stored on disk
- **Key derivation** -- The encryption passphrase is derived from the admin password using PBKDF2 with SHA-256
- **Session management** -- Random hex tokens with 24-hour expiry
- **Share links** -- Single-use, 15-minute expiry, cryptographically random 32-char tokens
- **Password hashing** -- bcrypt with automatic salting

## License

MIT