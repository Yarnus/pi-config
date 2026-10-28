# Repository Guidance

This repository lives at `~/.pi`. Edit configuration and custom resources directly under `agent/`; Pi discovers them in their native locations.

- Keep `.gitignore` as an explicit allowlist. Add only portable configuration, source, documentation, and tests. Credentials, sessions, downloaded packages, external skill checkouts, and generated environments stay untracked.
- `agent/AGENTS.md` contains global Pi instructions; this file describes repository maintenance.
- Pi is installed independently. This repository supplies owned resources from `agent/`; `pi update --extensions` fetches the declared Git skills, while Pi installs missing pinned npm packages at startup.
- Third-party skills are selected with Git package filters in `agent/settings.json`; Pi stores checkouts outside Git. The PDF skill creates its ignored Python environment on first use.
- After changing resources or dependencies, run `npm ci --omit=peer` and `npm test` when applicable. Review `git status --short --untracked-files=all` before staging.
- Use a fresh Pi process to verify runtime changes. Automated tests do not establish terminal appearance or live provider connectivity.
