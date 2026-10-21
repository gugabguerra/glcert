# Changelog

All notable changes to GLCert. Newest first; versions match the git tags and the root `VERSION`
file.

## [1.0.0] — 2026-10-21

### Fixed

- The audit log now records CA, certificate, CA-permission, user, settings, backup and
  factory-reset operations with the acting user; previously nothing was ever written, so the
  audit page stayed empty.
- New CAs and certificates now use the requested `keyAlgorithm` (`rsa`, `ecdsa` with an optional
  `ecdsaCurve`, or `ed25519`) instead of always generating RSA keys, and regenerating a
  certificate keeps its algorithm, size and curve. Certificates can now also be issued under
  imported ECDSA or Ed25519 CAs, and unknown algorithms are rejected with 400.
- Dashboard counts (CAs, certificates, expiring, expired) are now limited to the CAs an operator
  or viewer is granted, instead of showing totals for every CA.
- Operators with no CA grants no longer see every CA and certificate in the lists, and child CAs
  of a granted CA now appear in the CA and certificate lists as they already did for direct
  access.
- CA and certificate lists (including groups and group downloads) now fail closed when a user's
  permissions cannot be loaded, instead of returning unfiltered results.

## [1.0.0-rc.1] — 2026-10-18

### Added

- MIT license, contributing guide, issue and pull-request templates, editor configuration.

### Changed

- Configuration is now layered — built-in defaults → `config.json` → `.env` → real environment
  (rightmost wins). A malformed `config.json` refuses to start; the `.env` layer warns and skips
  bad lines and unknown keys.
- Repository restructured for public release: technical documentation moved to `docs/`
  (architecture, API reference, database schema), `ASSETS/` renamed to `assets/`, and the
  project conventions adopted (`AGENTS.md`, `docs/CONVENTIONS.md`).
- Version is single-sourced from the root `VERSION` file and injected into builds at compile
  time.

## [0.7.0] — 2026-08-13

Summarized from the user's point of view; see the git history for details.

### Added

- Multi-user support with admin / operator / viewer roles and per-CA permission grants (child
  CAs included through chain traversal).
- Administration panel: user management, filterable audit log, backup, restore, factory reset.
- Desktop app: webview shell with the frontend embedded in the binary, macOS distribution build.
- MFA / TOTP with QR setup, single-use backup codes, and encrypted secret storage.
- Temporary share links (single-use, 15-minute) with optional email delivery.
- Certificate version history with restore and regeneration; import for certificates and CAs.
- Expiration notifications via Shoutrrr (Discord, Slack, Telegram, SMTP, 20+ services).
- Email integration (SMTP) for password reset and expiration alerts.
- Dark / light / system theme, responsive layout, password strength meter, setup wizard.

### Changed

- Security hardening: rate-limited auth endpoints, all sessions invalidated on password change,
  per-CA authorization enforced on downloads and detail views, security headers and body limits
  on every request, path-traversal rejection for CA/certificate names, zip-slip protection on
  backup restore, admin-gated notification test endpoints, fail-closed encryption when the key
  service is locked, user-enumeration prevention in login and password reset, reset links built
  from a validated base URL, hardened upload handling.

### Fixed

- Theme auto-selection; share emails no longer allow HTML injection or user enumeration.
