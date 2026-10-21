# Security

GLCert is a self-hosted PKI manager for lab and private environments. It assumes an operator team
you trust, running on a network you control, behind a TLS reverse proxy. This document is the
full version of the README's security notes.

## How access works

- **Accounts** — passwords are bcrypt hashes; roles are admin / operator / viewer, with per-CA
  grants for the latter two (child CAs included through chain traversal). Authorization is
  enforced server-side on every request; the UI only hides what is already refused. Lists and
  dashboard counts are scoped the same way, so totals never reveal CAs or certificates outside
  a user's grants.
- **Sessions** — random bearer tokens, 24-hour expiry, cleared on every restart. Changing a
  password invalidates **all** sessions. Login and password-reset endpoints are rate-limited and
  never reveal whether an account exists.
- **MFA** — TOTP with AES-GCM-encrypted secrets and single-use SHA-256-hashed backup codes.
- **Password reset** — single-use, one-hour tokens delivered by email; links are built from a
  validated base URL.
- **Share links** — single-use, 15-minute, unauthenticated download tokens for exactly one file.
- **Audit log** — every successful state change to CAs, certificates, CA grants, users, settings
  and backups, and every factory reset, writes an `audit_log` row with the acting user's id and
  email, the action, the affected entity and a short subject (a name or an email). Rows never
  hold passwords, tokens, keys or other free text. A factory reset wipes the log and then
  records itself as the first entry of the new one. Share-link generation, downloads, logins and
  self-service account changes are not audited.

## What is encrypted

- Private keys at rest — AES-GCM under the master key in `data/encryption.key`; the service
  **fails closed** if the key is unavailable.
- TOTP secrets and key passphrases (AES-GCM); passwords (bcrypt); backup codes (SHA-256).
- Backups are password-encrypted ZIP archives.

## What is *not* protected

- **Transport** — GLCert speaks plain HTTP; anyone on the path can read traffic, including
  tokens. *Mitigation:* run behind a TLS reverse proxy (Caddy, nginx) or a private tunnel
  (Tailscale); never expose the raw port to the internet.
- **Database at rest** — `data/database.sqlite` is not encrypted: metadata (names, subjects,
  expiry dates, audit entries) is readable to anyone with disk access. *Mitigation:* disk
  encryption and restrictive permissions on `data/` (it also holds the master key).
- **Bearer tokens** — a stolen token is a full session until expiry; there is no device
  binding. *Mitigation:* log out on shared machines; restarts clear all sessions.
- **Share links** — anyone holding the URL can download the file once, within 15 minutes.
  *Mitigation:* share only when needed; links are single-use and self-expire.
- **Operator access** — operators can download private keys for CAs they are granted.
  *Mitigation:* grant narrowly, review `ca.permissions.update` audit entries, revoke by deleting
  the grant or the user.
- **Email** — reset and share links travel by SMTP. *Mitigation:* TLS SMTP and a dedicated
  mailbox.

## Hardening checklist

1. Put GLCert behind a TLS reverse proxy; never expose the raw port to the internet.
2. Run as a non-root user and lock down `data/` (e.g. `chmod 700`) — it holds the master key and
   every private key.
3. Enable MFA for admins; when people leave, delete their accounts (sessions cascade).
4. Keep `LOG_LEVEL` at `info` outside debugging sessions.
5. Back up regularly (`POST /api/backup/create`); store the backup password separately from the
   backup file.
6. When retiring an instance, wipe thoroughly: factory reset (admin) or delete `data/` entirely.

## Reporting a problem

Use GitHub's **private vulnerability reporting** on the repository — it keeps the report out of
the public issue tracker and needs no email contact. Responses are **best-effort with no service
level**: this project is maintained for personal use (see README § Project status), so a fix may
be slow or never come. Include the version from `docs/CHANGELOG.md` and log output at
`LOG_LEVEL` — logs contain no secrets, so they are safe to share. If you depend on GLCert
seriously, maintain your own fork.
