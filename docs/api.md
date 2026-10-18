# API reference

All endpoints live under `/api`. The backend serves the SPA in production, so anything that is not
an `/api` route falls through to the frontend.

## Authentication

- `POST /api/auth/login` returns a session token; send it on every protected request as
  `Authorization: Bearer <token>`.
- Sessions expire after 24 hours and are cleared on server restart (re-login is required).
- Login with TOTP enabled first returns a short-lived pending token, then `POST /api/totp/verify`
  exchanges it for a real session.
- Two endpoints are deliberately unauthenticated: the setup wizard (only while no admin exists)
  and `GET /api/share/{token}` (single-use, 15-minute download links).

## Errors

Errors return a plain-text body with an appropriate HTTP status (`400`, `401`, `403`, `404`,
`409`, `500`). Messages never leak whether an account exists.

## Public routes (no auth)

| Method | Route                      | Description                    |
| ------ | -------------------------- | ------------------------------ |
| GET    | /api/health                | Health check                   |
| GET    | /api/auth/status           | Check if setup is complete     |
| POST   | /api/auth/setup            | Create admin account (once)    |
| POST   | /api/auth/login            | Login (returns token + user)   |
| POST   | /api/auth/forgot-password  | Request password reset email   |
| POST   | /api/auth/reset-password   | Reset password with token      |
| POST   | /api/totp/verify           | Verify TOTP code (during login)|
| POST   | /api/backup/restore        | Restore from encrypted backup  |
| GET    | /api/share/{token}         | Download bundle via share link |

## Protected routes — any role

| Method | Route                         | Description              |
| ------ | ----------------------------- | ------------------------ |
| POST   | /api/auth/logout              | Logout                   |
| PUT    | /api/auth/password            | Change own password      |
| GET    | /api/totp/status              | Get TOTP status          |
| GET    | /api/totp/setup               | Generate TOTP secret + QR|
| POST   | /api/totp/verify-setup        | Verify and enable TOTP   |
| POST   | /api/totp/disable             | Disable TOTP             |
| GET    | /api/users/me                 | Get current user profile |
| PUT    | /api/users/me                 | Update current user name |
| GET    | /api/dashboard                | Dashboard stats (scoped) |
| POST   | /api/notifications/test       | Send test notification   |
| POST   | /api/notifications/test-email | Send test email          |
| POST   | /api/share/{type}/{id}        | Generate share link      |
| POST   | /api/share/send-email         | Send share link via email|
| GET    | /api/ca                       | List CAs (filtered by permissions for non-admins) |
| GET    | /api/ca/{id}                  | Get CA                   |
| GET    | /api/ca/{id}/download/cert    | Download CA cert         |
| GET    | /api/ca/{id}/download/key     | Download CA key          |
| GET    | /api/ca/{id}/download/bundle  | Download CA bundle       |
| GET    | /api/certificates             | List certificates (filtered by permissions for non-admins) |
| GET    | /api/certificates/groups      | List certificate groups  |
| GET    | /api/certificates/download/group | Download group as ZIP |
| GET    | /api/certificates/{id}        | Get certificate          |
| GET    | /api/certificates/{id}/versions | List versions          |
| GET    | /api/certificates/{id}/download/cert | Download cert PEM |
| GET    | /api/certificates/{id}/download/key  | Download key PEM  |
| GET    | /api/certificates/{id}/download/ca   | Download CA PEM   |
| GET    | /api/certificates/{id}/download/bundle | Download bundle (ZIP/TGZ) |

## Protected routes — operator + admin

| Method | Route                                              | Description            |
| ------ | -------------------------------------------------- | ---------------------- |
| POST   | /api/ca                                            | Create CA              |
| POST   | /api/ca/import                                     | Import external CA     |
| DELETE | /api/ca/{id}                                       | Delete CA              |
| POST   | /api/certificates                                  | Create certificate     |
| POST   | /api/certificates/import                           | Import certificate     |
| PATCH  | /api/certificates/{id}                             | Update certificate group |
| POST   | /api/certificates/{id}/regenerate                  | Regenerate certificate |
| POST   | /api/certificates/{id}/versions/{version}/restore  | Restore version        |
| DELETE | /api/certificates/{id}/versions/{version}          | Delete version         |
| DELETE | /api/certificates/{id}                             | Delete certificate     |

Operators may only touch the CAs they have been granted (including child CAs of a granted CA);
every operation is scoped server-side, not in the UI.

## Protected routes — admin only

| Method | Route                              | Description                  |
| ------ | ---------------------------------- | ---------------------------- |
| GET    | /api/settings                      | Get settings                 |
| PUT    | /api/settings                      | Update settings              |
| POST   | /api/admin/factory-reset           | Delete all data              |
| POST   | /api/backup/create                 | Create backup                |
| GET    | /api/users                         | List all users               |
| POST   | /api/users                         | Create new user              |
| PUT    | /api/users/{id}                    | Update user name/role        |
| POST   | /api/users/{id}/reset-password     | Admin reset user password    |
| DELETE | /api/users/{id}                    | Delete user                  |
| GET    | /api/ca/{id}/permissions           | Get CA permission assignments |
| PUT    | /api/ca/{id}/permissions           | Set CA permission assignments |
| GET    | /api/audit                         | List audit log entries       |
