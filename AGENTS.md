# Repository Guidance

This repository lives at `~/.pi`. Edit configuration and custom resources directly under `agent/`; Pi discovers them in their native locations.

- Keep `.gitignore` as an explicit allowlist. Add only portable configuration, source, documentation, and tests. Credentials, sessions, downloaded packages, external skill checkouts, and generated environments stay untracked.
- `agent/AGENTS.md` contains global Pi instructions; this file describes repository maintenance.
- `setup-pi.sh` installs pinned dependencies and external skills. `setup-pi.sh --check` validates without changing files. Neither links configuration to another repository nor manages `~/.agents/skills`.
- External skills are pinned in `external-skills.json`. Preserve modified checkouts and resolve drift before rerunning setup.
- After changing configuration, resources, or dependencies, run `./setup-pi.sh`, `./setup-pi.sh --check`, and `npm test`. Review `git status --short --untracked-files=all` before staging.
- Use a fresh Pi process to verify runtime changes. Automated tests do not establish terminal appearance or live provider connectivity.
