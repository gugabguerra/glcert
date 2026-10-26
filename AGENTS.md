# AGENTS.md

GLCert — self-hosted PKI manager. Backend: Go 1.27, Chi, pure-Go SQLite (no CGO). Frontend:
React 19, TypeScript, Mantine v9, Vite. Desktop variant: webview shell with the frontend embedded
via `go:embed`. Node 24+ and npm for frontend work.

## Documentation

- `README.md` — canonical feature inventory and product behavior. Update its **Features** list
  whenever user-visible behavior changes.
- `docs/CHANGELOG.md` — add an `### Added` / `### Fixed` entry under `[Unreleased]` for notable
  behavior changes (minor or quick ones need none); add the version section at the next tag.
- `docs/SECURITY.md` — canonical security model; update it when auth, storage, or network
  behavior changes.
- `docs/CONVENTIONS.md` — human-facing standards: git workflow, commit style, doc routing,
  versioning, dependencies, and markdown/code style. This file defers to it.
- `docs/architecture.md`, `docs/api.md`, `docs/schema.md` — technical reference; update them when
  components, routes, or tables change.
- `docs/local/` — gitignored planning, design, and deployment notes; never commit its contents.
  Keep private hosts, credentials, and tokens out of tracked files.
- **Markdown style**: wrap prose at 100 columns; keep code blocks and tables unchanged.

## Maintaining AGENTS.md

Durable agent policy only — not product docs, feature logs, or API specs. Never edit it during
routine work (features, fixes, refactors, UI tweaks, endpoints). Edit only when the user explicitly
asks, when a core dev command or workflow rule changes, or when a cross-cutting invariant spans
subsystems and can't be enforced by tests or code comments. Routing: feature behavior → README;
security behavior → SECURITY.md; config defaults → `internal/config` + README; narrow
implementation details → code comments and unit tests.

## Run & verify

- Commands: the root `Makefile` is canonical for builds (`make embed-frontend`,
  `make build-desktop-*`, `make build-macos-app`); tests run with `cd backend && go test ./...`
  and `cd frontend && npm run build` (type-check + bundle).
- Start: `cd backend && go run ./cmd/server` (API on `http://localhost:18080`) and
  `cd frontend && npm run dev` for the Vite dev server.
- State: `data/` (`database.sqlite`, `encryption.key`, `certificates/`) survives restarts;
  delete the folder to reset. Sessions are cleared on every restart — re-login is required.
- Docker: `docker-compose.yml` — mount a volume for `data/` or state is lost.

## Git workflow

- **Never commit without the user's explicit acknowledgement** — ask first, then wait. Keep
  AGENTS.md edits out of commit messages.
- `main` is stable; never commit feature work directly to it unless the user explicitly asks
  (minor change). One branch per change. During the v1 push every branch carries the `v1-`
  prefix: `v1-feature/<short-name>`, `v1-fix/<short-name>` (drop the prefix after v1.0.0).
- Conventional Commits (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`); squash-merge into `main`,
  then delete the branch. Tag stable checkpoints: `git tag -a vX.Y.Z -m "..."`.

## Layout

Multi-component repository:

- `backend/` — Go service. `cmd/server` (headless) and `cmd/desktop` (webview, build tag
  `desktop`); `internal/` holds `server` (router), `handlers` (HTTP), `services` (business
  rules), `database` (SQLite + migrations), `config`, `logger`, `models`, `backup`, `embedded`.
- `frontend/` — SPA. `src/{api.ts,auth.tsx,App.tsx}` plus `components/`, `pages/`, `utils/`.
- `docs/` — this documentation set; `docs/local/` is gitignored scratch space.
- `assets/` — brand images and app icons (the Makefile builds macOS `.icns` from them).
- `Makefile`, `Dockerfile`, `docker-compose.yml` — build and deployment entry points.

## Invariants (easy to break)

- Per-CA authorization is enforced **server-side** on every CA and certificate operation —
  including child CAs reached through chain traversal. Hiding rows in the UI is UX only.
- Private keys are encrypted at rest (AES-GCM, master key in `data/encryption.key`). When the
  crypto service is locked or unavailable the system **fails closed**, never open.
- Share links are single-use, 15-minute, unauthenticated download tokens for exactly one file.
  Build their URLs only from validated base URLs; never route anything else through them.
- Never build filesystem paths from raw user input: reject path-traversal characters in CA and
  certificate names, and guard archive extraction against zip slip.
- Never reveal whether an account exists (login, password reset). Rate-limit auth endpoints and
  invalidate **all** sessions when a password changes.
- Security headers and request body limits apply to every response/request.
- Secrets never appear in responses or logs: passwords are bcrypt hashes, TOTP secrets are
  AES-GCM blobs, backup codes are SHA-256 hashes. Never log cookies, tokens, or user text.
- Keep private hosts, credentials, tokens, and personal data out of tracked files; `docs/local/`
  is the place for them. A pre-commit privacy guard enforces this.
