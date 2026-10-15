# Contributing

Standards live in `docs/CONVENTIONS.md`; durable agent policy lives in `AGENTS.md`.
`docs/local/` is gitignored scratch space and is never committed.
Use one branch per change (`feature/<short-name>`, `fix/<short-name>`) with
Conventional Commits (imperative, lower-case subject, no trailing period),
squash-merged into `main`.
Run `go test ./...` in `backend/` and `npm run build` in `frontend/` before
committing.
Never commit without the maintainer's explicit acknowledgement.
