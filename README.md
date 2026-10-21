# GLCert

Self-hosted PKI manager for lab and private environments. Create certificate authorities, issue and
manage TLS certificates, and control access from a web interface — without using OpenSSL.

> **Deployment note:** GLCert serves plain HTTP. Put it behind a TLS reverse proxy before using it
> across an untrusted network, and do not expose its application port directly to the internet.
> See the [security model](docs/SECURITY.md) for deployment assumptions and hardening steps.

## Screenshots

Screenshots are coming soon. Replace each placeholder below with an image when they are ready.

| Dashboard | Certificate authorities |
|---|---|
| *Screenshot placeholder* | *Screenshot placeholder* |

| Certificate details | User administration |
|---|---|
| *Screenshot placeholder* | *Screenshot placeholder* |

## Features

- **Certificate authorities:** Create or import root and intermediate CAs with RSA, ECDSA, or
  Ed25519 keys. Manage parent-child chains and download certificates and private keys.
- **Certificate lifecycle:** Issue server, client, combined, or self-signed certificates with
  RSA, ECDSA (P-256, P-384, P-521), or Ed25519 keys. Set validity periods, regenerate
  certificates (keeping their key algorithm), and restore earlier versions.
- **Role-based access:** Admin, Operator, and Viewer roles, with per-CA permissions enforced by
  the server.
- **Downloads and sharing:** Download individual files or ZIP/TGZ bundles. Create single-use,
  time-limited links for sharing certificates, keys, or bundles.
- **Administration:** Manage users, review a filterable audit log, configure system settings, and
  perform backup, restore, or factory reset operations.
- **Multi-factor authentication:** Optional TOTP with encrypted secret storage and single-use
  backup codes.
- **Notifications:** Send CA and certificate expiration alerts through SMTP or supported webhook
  services. Configure a threshold and send a test notification.
- **Backup and restore:** Create password-encrypted ZIP backups. Restoring merges data without
  overwriting existing records.
- **Responsive interface:** Use the dashboard on desktop or mobile, with dark, light, and system
  theme options.

## Quick start

### Docker Compose

With Docker Compose installed, run this from the repository root:

```sh
docker compose up -d --build
```

Open [http://localhost:8080](http://localhost:8080) and complete the setup wizard. Compose stores
application data in the persistent `glcert-data` volume, so the data survives container restarts.

### Local development

Prerequisites: Go 1.25+, Node.js 20+, and npm.

Start the backend:

```sh
cd backend
go mod download
go run ./cmd/server
```

The API is available at `http://localhost:18080`. In another terminal, start the frontend:

```sh
cd frontend
npm install
npm run dev
```

The frontend runs at `http://localhost:3000` and proxies API requests to the backend.

## Role permissions

| Action | Admin | Operator | Viewer |
|---|:---:|:---:|:---:|
| View dashboard | Yes | Yes | No |
| View or download CAs | Yes | Assigned CAs | No |
| View or download certificates | Yes | Assigned CAs | Shared certificates |
| Create or delete CAs | Yes | No | No |
| Import CAs | Yes | No | No |
| Create or delete certificates | Yes | Assigned CAs | No |
| Manage users | Yes | No | No |
| View audit log | Yes | No | No |
| Backup, restore, or factory reset | Yes | No | No |
| System settings | Yes | No | No |
| Create share links | Yes | Yes | Yes |

The server checks CA permissions on every operation. Access checks also follow the parent CA chain
when an operation addresses a child CA.

## Configuration

Configuration is layered, with values on the right taking precedence:

```text
defaults → config.json → .env → real environment variables
```

`config.json` is read from the working directory by default. Set `CONFIG_FILE` to load another
file. Invalid JSON, types, or values stop startup. The optional, gitignored `.env` file is loaded
next; malformed lines and unknown keys are skipped with a warning. Set `ENV_FILE` to load another
dotenv file. Real environment variables take precedence over both files.

| `config.json` key | Environment variable | Default | Description |
|---|---|---:|---|
| `port` | `PORT` | `18080` | HTTP server listen port |
| `dataDir` | `DATA_DIR` | `./data` | Database and certificate storage directory |
| `logLevel` | `LOG_LEVEL` | `info` | Log verbosity: `debug`, `info`, `warn`, `error`, or `fatal` |

| Loader variable | Default | Purpose |
|---|---|---|
| `CONFIG_FILE` | `./config.json` | Selects the JSON configuration file |
| `ENV_FILE` | `./.env` | Selects the dotenv file |

Docker Compose overrides the port to `8080` and stores data in `/data`.

## Notifications

Expiration notifications can be sent through SMTP or through [Shoutrrr-supported
services](https://shoutrrr.nickfedor.com/services/overview/), including Discord, Slack, Telegram,
and Gotify. Configure the destination and alert threshold in **Settings → Notifications**. You can
send a test notification from the same page.

GLCert also supports SMTP for password-reset and expiration-alert email. Treat webhook URLs and
SMTP credentials as secrets; keep them out of tracked files.

## Security

- Private keys are encrypted at rest. Restrict access to the data directory, which also contains
  the encryption key material.
- The database is not encrypted at rest, and the server uses plain HTTP. Use a TLS reverse proxy,
  protect the data directory, and keep encrypted backups in a separate secure location.
- Sessions expire after 24 hours and are cleared on server restart. Password changes invalidate
  all sessions.
- MFA is available for accounts. Share links are single-use and expire after 15 minutes.

Read [docs/SECURITY.md](docs/SECURITY.md) before deploying. It documents the security boundaries,
hardening checklist, and vulnerability reporting process.

## Project status

GLCert is maintained as a personal homelab project. There is no support service, response-time
commitment, release schedule, or compatibility guarantee. Issues and pull requests may go
unanswered. Forking and maintaining your own copy is encouraged; contributions are welcome on a
best-effort basis. See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## Documentation

- [Architecture](docs/architecture.md)
- [API reference](docs/api.md)
- [Database schema](docs/schema.md)
- [Security model](docs/SECURITY.md)
- [Changelog](docs/CHANGELOG.md)

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Go 1.25, Chi, `crypto/x509` |
| Frontend | React 19, TypeScript, Mantine v9, Vite |
| Database | SQLite with a pure-Go driver (no CGO required) |
| Notifications | Shoutrrr |
| Deployment | Docker and Docker Compose |

## License

MIT — see [LICENSE](LICENSE).
