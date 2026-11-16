# Changelog

All notable changes to GLcert. Newest first; versions match the git tags and the root `VERSION`
file.

## [Unreleased]

### Added

- Passkeys as a second factor. After the password, sign in with a fingerprint, face, screen lock
  or security key in place of a code from the authenticator app. Add, name and remove them under
  Two-factor on your account page; an account can use passkeys, the app, or both, and the first
  one you add comes with backup codes. Passkeys need a browser on HTTPS at the `PUBLIC_URL`
  address (or `http://localhost:<port>` when it is unset); in the desktop app they depend on the
  system web view. New dependency: `github.com/go-webauthn/webauthn`.

### Fixed

- Setting up the authenticator app again now replaces the old backup codes. Before, the earlier
  set kept working next to the new one.

## [1.1.3] — 2026-11-15

### Fixed

- Desktop release builds work again. The `Makefile` didn't parse (the macOS `Info.plist` was an
  inline heredoc), so every tagged release since 1.0.0 published no downloads. The plist is now a
  template in `assets/macos/`, every desktop target builds with cgo as `webview_go` requires, and
  the Release workflow installs the GTK/WebKit and mingw-w64 toolchains for Linux and Windows
  (`assets/windows/include` supplies a WebView2 header older mingw-w64 lacks). The
  macOS app is now `GLcert.app` in `GLcert-macos.zip`, universal and ad-hoc signed; the Windows
  build no longer opens a console window.
- CI is green again: lint and the build job now see an embedded frontend, and the lint findings
  this had hidden are fixed (unchecked errors in tests, deprecated ECDSA key comparisons now use
  `PublicKey.Equal`).

## [1.1.2] — 2026-11-15

### Changed

- New logo, the "key bar" mark: five bars whose outline forms a shield, the centre bar split into
  a dot and a stem like a keyhole. It replaces the old padlock icon and the stroke shield
  everywhere: sidebar, sign-in screens, favicons (now also an SVG favicon that follows the
  system light or dark theme), home-screen icons and the macOS app icon. Masters live in
  `assets/logo/`. The product name is now written "GLcert" in the interface.

## [1.1.1] — 2026-10-26

### Fixed

- Toolchain and base images upgraded for the October 2026 Node.js CVE: the Docker image now builds
  with Node 24 (was the end-of-life Node 20) and Go 1.27, and runs on Alpine 3.24 (was the
  end-of-life 3.19). CI uses the same versions. All Go modules and npm packages move to their
  latest releases, including React Router 7, which fixes two moderate advisories in React Router
  6. TypeScript moves to 6.0, the newest version typescript-eslint supports.

## [1.1.0] — 2026-10-23

### Added

- Validity timeline as the home screen, replacing the dashboard: authorities and certificates on
  a shared 18-month or 6-year axis, a banner when certificates outlive their authority, and a
  details panel with downloads, share links, regenerate and delete.
- Certificates page redesigned: grouped by issuing authority with a small validity bar per row,
  type counts, group and sort selects, a name filter, and the same details panel as the timeline.
- Authority page redesigned: days left at a glance, a timeline of its certificates with the date
  the authority ends, a warning when certificates outlive it, and a "Who can use it" list where
  admins grant or remove access. The delete note now says what actually happens: issued
  certificates are kept and intermediates become roots.
- New certificate form redesigned with a live preview: the new certificate's validity against
  its authority's, a warning when it would outlive the authority with "Shorten to N days" and
  "Use <longer authority>" fixes, the first alert date, and the subject as it will be issued.
  It defaults to the longest-lasting authority and takes all alternative names in one field.
- Share link dialog redesigned: pick one file (with a warning when it is the private key), create
  the link, copy it or a ready-made wget or curl command, watch a live 15-minute countdown, and
  email it in the same dialog. Choosing another file asks for a new link, since each link carries
  exactly one file.
- Users page: everyone who can sign in with their role, two-factor status and the authorities
  they can use, add and edit dialogs that set role, authorities and password together, and the
  role permission table.
- Audit log page: filter by kind of change, person and text, a changes-per-day chart for the last
  90 days, entries grouped by day in plain language, expandable details, and "Show all time".
- Account page: name, appearance (match system, light or dark), password change, two-factor
  status with set up again or turn off, and how sessions end.
- Two-factor setup as three steps: scan the QR code or type the key, check a code, then see the
  backup codes once.
- A reminder to turn on two-factor appears after signing in to an account without it. "Remind
  me in a week" puts it off for seven days in that browser; closing it lasts until the next
  sign-in.
- `GET /api/certificates` returns `issuedAt`, when each certificate's current version was issued.
- `PUBLIC_URL` setting (`publicUrl` in `config.json`): the externally reachable http(s) origin used
  to build password-reset and emailed share links. The desktop build defaults it to
  `http://localhost:<port>`.
- `POST /api/auth/unlock-encryption` (admin, rate limited): unlock with the setup encryption
  passphrase and your password when no admin sign-in can. No interface yet; use curl.

### Changed

- The interface adopts the GL Design System: slate palette, emerald brand, a cyan accent used only
  for state, self-hosted Oxanium and IBM Plex Mono, and matching dark and light themes. Existing
  screens pick up the new colours and controls ahead of their redesign.
- The top navigation bar is replaced by a sidebar: workspace links, an authority tree with
  certificate counts and an "outlives its authority" warning, an admin group, and an account
  footer with the theme switch and sign out. It collapses to an icon rail below 1200px (or on
  demand) and opens as a drawer on phones. Your profile now opens as a page, not a drawer.
- Administration is split into Users and Audit log pages, and backup, restore and factory reset
  move into Settings. Old `/admin` links redirect. Settings now save as one form with "Save
  changes" and "Discard changes", and field labels across the app use the smaller muted style.
- Sign in and the two-factor check are redesigned: a warning when the page is served over plain
  HTTP from another machine, six code boxes, an inline backup code option, and wording that
  never reveals whether an account exists.
- The sidebar's account row shows only the role, and authorities in the sidebar tree show a shield
  icon.
- Encryption keys use a new scheme: the setup passphrase is the root secret and each admin holds
  a copy wrapped with their own password. Any admin sign-in unlocks the service. On the first
  admin sign-in after upgrading, `data/encryption.key` is migrated once and automatically (keys,
  TOTP secrets, CA passphrases and the SMTP password are re-encrypted; the old file is kept as
  `data/encryption.key.v1`). Back up `data/` before upgrading.
- Password-reset and share emails need `PUBLIC_URL`. Without it, forgot-password sends no email and
  `POST /api/share/send-email` returns `503`.
- `POST /api/share/send-email` takes `{email, token, fileName}`; the server builds the link. The
  `url` and `fileType` fields are gone.
- `POST /api/totp/verify-setup` takes only `{code}`; the server keeps the issued secret and
  backup codes for 15 minutes.
- `POST /api/admin/factory-reset` requires `{password}`; it also clears share links, the SMTP
  password and `encryption.key.v1`.
- A CA, or a certificate of the same type, cannot reuse an existing name (case-insensitive): `409`.
  The name `.` is rejected.
- Every request body is capped at 1 MiB (backup restore keeps 128 MiB). The server sets header
  and idle timeouts.

### Fixed

- "Forgot password" and the emailed reset link work while signed out; before, every signed-out
  address showed the sign-in form.
- A changed name or two-factor status now survives a page reload.
- Saving one Settings section no longer sends stale values for the others: the page keeps one
  draft of the whole record, which the server replaces on every save.
- Signing in no longer changes the hook order of the app's router component.
- Changing or resetting an admin password no longer makes encrypted data unreadable, a second
  admin can sign in (it returned `500`), and a forgotten-password reset no longer locks the admin
  out of the keys. A sign-in never fails because of encryption; operations stay locked instead.
- The SMTP password is never stored in plaintext: saving it while encryption is locked returns
  `503`, and reading it while locked fails.
- Share links are claimed atomically, so a link is served exactly once even under concurrent
  requests. Responses are `no-store` and tokens are redacted from request logs.
- Deleting a CA requires access to it, and creating an intermediate requires access to its parent.
- A duplicate CA or certificate name no longer overwrites the other entry's key files, and
  deleting a CA named `.` no longer removes every CA's files.
- Unknown accounts take as long to reject as wrong passwords, and failed logins no longer log the
  email address.
- A pending two-factor sign-in is burned after 5 wrong codes, and a backup code cannot be spent
  twice under concurrent requests.

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
- Two-factor authentication (TOTP) with QR setup, single-use backup codes, and encrypted secret
  storage.
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
