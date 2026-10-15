# Conventions

Human-facing standards for this project. Durable agent policy lives in `AGENTS.md`, which defers
here; if the two ever disagree, fix both.

## Git workflow

- `main` is stable. One branch per change: `feature/<short-name>`, `fix/<short-name>`.
  Squash-merge into `main`, then delete the branch.
- Conventional Commits: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`. Subject in the imperative,
  lower-case, no trailing period.
- Tag stable checkpoints: `git tag -a vX.Y.Z -m "..."`. The changelog's version section is added at
  the tag; versions match the git tags and the root `VERSION` file.
- Never commit without the maintainer's explicit acknowledgement.

## Versioning & release

- The root **`VERSION` file is the single source of truth**: at a release it matches the git tag
  (`vX.Y.Z`) and the changelog section. Build scripts inject it into the Go binaries via
  `-ldflags "-X main.version=..."` (see the `Makefile`); `frontend/package.json` is kept in sync.
- The changelog's `[Unreleased]` becomes the version section at the tag.
- Release artifacts — binaries, container images, the macOS `.app` — are built from the tag and
  published as release assets. **Never commit them**: `dist/`, `build/`, and `out/` stay ignored.

## Documentation routing

| Change                              | Document                                  |
|-------------------------------------|-------------------------------------------|
| User-visible behavior               | `README.md` § Features                    |
| Auth, storage, or network behavior  | `docs/SECURITY.md`                        |
| Routes or request/response shapes   | `docs/api.md`                             |
| Database tables or columns          | `docs/schema.md`                          |
| Components, build, or data layout   | `docs/architecture.md`                    |
| Config defaults or new settings     | `backend/internal/config` + README        |
| Release notes                       | `docs/CHANGELOG.md` under `[Unreleased]`  |
| Narrow implementation details       | code comments and unit tests              |
| Planning, issues, private notes     | `docs/local/` (gitignored, never commit)  |
| License or copyright holder         | `LICENSE` + `README.md` § License         |

## Markdown style

- Wrap prose at 100 columns; keep code blocks and tables unchanged.
- Headings sentence case. Feature bullets describe user-visible behavior, one to three lines each.

## Configuration

- Configuration comes from environment variables (`SCREAMING_SNAKE_CASE`) with defaults in
  `backend/internal/config`; every variable is documented in the README's configuration table.
- Fail fast on bad configuration; never fall back silently. Missing variables use their defaults,
  but invalid values refuse to start.
- Duration settings are expressed in **hours** (fractions allowed) where the UI exposes them;
  timestamps are epoch milliseconds.

## Code style

- Go: `gofmt` / `goimports` and `golangci-lint` are canonical — run them before every commit.
  TypeScript: ESLint + Prettier with the repo's configs.
- Pure rules over injected time — logic that depends on "now" takes the clock as a parameter so it
  is testable without waiting.
- Structured one-line log events; never log secrets or user text.
- Security checks (auth, role, per-CA scope, rate limits) live server-side, before state mutates.
  Client-side guards are UX only.
- One vocabulary across layers: the same concept keeps the same name in config keys, env vars, API
  paths, and UI. Renames are breaking changes — no shims, no aliases.

## Dependencies

- Every dependency earns its place — prefer the standard library, and justify additions in the
  commit or PR body.
- `go.mod`/`go.sum` and `package-lock.json` are committed; security updates land first.
- Automated dependency-update PRs (Dependabot / Renovate) are welcome — merge when CI is green.

## API conventions

- Endpoints live under `/api` and follow the one-vocabulary rule above. Breaking changes get a
  new URL prefix (`/api/v2`) — no silent shape changes.
- Errors return a plain-text body with an appropriate HTTP status (`400`/`401`/`403`/`404`/`500`);
  messages never reveal whether an account exists.
- Authentication travels in an `Authorization: Bearer <token>` header — never in URLs, never in a
  response body. State-changing endpoints enforce role and per-CA authorization server-side
  before any state mutates.

## Tests

- Go tests are colocated with the package they cover (`*_test.go`); the security suites under
  `backend/internal/server/` document the invariants in `AGENTS.md`.
- Prefer pure unit tests of the rules; integration tests go through the public API surface.
- Suites must be independent of machine state and of each other; use temp directories.
- Assertions state their intent in the message argument so a failure reads as a sentence.
