# Architecture

## Components

| Component  | What it is                                                        |
| ---------- | ----------------------------------------------------------------- |
| `backend/` | Go service (Chi router, pure-Go SQLite). Two entry points: `cmd/server` (headless) and `cmd/desktop` (webview app with embedded frontend). |
| `frontend/`| React 19 + TypeScript + Mantine SPA, built with Vite.              |
| `Makefile` | Builds, the frontend-embed step, desktop bundles, and the macOS `.app`. |
| `Dockerfile` / `docker-compose.yml` | Multi-stage container build for self-hosting.       |

## Request flow

```
HTTP → Chi router → middleware (session auth, RequireRole) → handlers → services → database / files
```

- `internal/server` wires the router; `internal/handlers/middleware.go` authenticates the Bearer
  token and enforces roles (`admin` / `operator` / `viewer`).
- Handlers parse and validate requests; business rules live in `internal/services`.
- Private keys never travel through the database: services write them to disk (see below) and
  store only encrypted blobs or filesystem references.

## Build & embed

`make embed-frontend` builds `frontend/` and copies the result into
`backend/internal/embedded/static/`, which `cmd/desktop` embeds into the binary with `go:embed`.
The headless server (`cmd/server`) instead serves `./static` if present. Desktop builds
(`make build-desktop-*`, `make build-macos-app`) compile one self-contained binary per platform;
the version string is injected at build time from the root `VERSION` file.

## Data directory

`DATA_DIR` (default `./data`, and `~/.glcert` style defaults for desktop) holds all mutable
state:

| Path               | Contents                                            |
| ------------------ | --------------------------------------------------- |
| `database.sqlite`  | All metadata (see `docs/schema.md`)                 |
| `encryption.key`   | Master key for private-key encryption at rest       |
| `certificates/`    | PEM material, organized per CA and certificate      |

Backups are password-encrypted ZIP archives of this directory; restore merges without
overwriting. **Mount a volume in Docker or state is lost on restart.**

## Background work

A goroutine (5 minutes after start, then hourly) checks certificates and CAs for expiration and
fires notifications (Shoutrrr — Discord, Slack, Telegram, SMTP, and 20+ more), and cleans up
expired sessions and pending TOTP sessions.

## Configuration

Environment variables only, with defaults in `backend/internal/config`:

| Variable   | Default   | Purpose                    |
| ---------- | --------- | -------------------------- |
| `PORT`     | `18080`   | HTTP listen port           |
| `DATA_DIR` | `./data`  | Mutable state location     |
| `LOG_LEVEL`| `info`    | `DEBUG`/`INFO`/`WARN`/`ERROR`/`FATAL` |

## Logging

`internal/logger` prints leveled one-line events to stdout/stderr (container-friendly). Logs
never contain secrets, tokens, or user text.

## Project structure

```
glcert/
  backend/
    cmd/
      server/main.go            Headless entry point
      desktop/main.go           Webview app entry point (build tag: desktop)
    internal/
      backup/backup.go          Encrypted-ZIP backup and merge-restore
      config/                   PORT, DATA_DIR, platform defaults
      database/                 SQLite connection + migrations
      embedded/                 go:embed of the built frontend (desktop)
      handlers/                 HTTP handlers + auth middleware
      logger/                   Leveled logger
      models/models.go          Domain models
      server/                   Router wiring and setup flow
      services/                 Business rules (auth, ca, cert, crypto, email,
                                notification, totp, audit)
  frontend/
    src/
      api.ts                    authFetch / JSON / download helpers
      auth.tsx                  Auth context, role helpers
      App.tsx                   Routes and role-based navigation
      components/               Shared components
      pages/                    One file per screen
      utils/                    Password scoring, clipboard
  docs/                         This documentation set
  assets/                       Brand images and app icons
  Makefile                      Build, embed, and packaging tasks
```
