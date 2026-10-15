# Contributing

This project is maintained best-effort for personal use — see README § Project status. There is
no support commitment: issues and pull requests may sit unanswered, and that is not a slight.

The dependable path is a **fork**: take the code (MIT licensed), adapt it, and maintain your own
changes. Pull requests are welcome and will be looked at eventually — without timelines.

For the maintainer's own workflow: standards live in `docs/CONVENTIONS.md`; durable agent policy
in `AGENTS.md`. `docs/local/` is gitignored scratch space whose contents are never committed. One
branch per change with Conventional Commits (imperative, lower-case subject, no trailing period).
Run `go test ./...` in `backend/` and `npm run build` in `frontend/` before committing. Never
commit without the maintainer's explicit acknowledgement.
