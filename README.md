# Pi dotfiles

Personal Pi configuration, maintained directly in `~/.pi` as a Git repository. Pi discovers custom resources under `agent/`; there is no local package registration or configuration link to another repository.

## Install

Requires macOS or Linux with Git, mise, and Python 3.10+ with venv and pip. On a new machine, clone this repository to `~/.pi`. If that directory already contains configuration or runtime data, back it up and merge deliberately before installing.

Run from `~/.pi`:

```bash
mise trust
mise install
mise exec -- ./setup-pi.sh
mise exec -- ./setup-pi.sh --check
mise exec -- npm test
mise exec -- pi
```

Setup installs the pinned Pi version when missing, Node development dependencies, the PDF Python environment, declared Pi packages, and external skills. It requires network access and a writable npm global prefix. An existing Pi version mismatch stops with an explicit switch command. Repeated runs are safe; modified skill checkouts or conflicting skill paths are reported and preserved.

Provide `CHRONO_KEY` through your shell environment or secret manager. For providers supporting interactive authentication, use `/login`. Credentials and session history are local runtime data, not part of installation or Git.

`--check` performs no installations or file changes. It checks versions, direct Node dependencies, PDF dependencies, Pi packages, and the pinned external skill checkouts and discovery links. It does not verify credentials, network services, or terminal appearance. Start a fresh Pi process after resource changes.

## Layout and ownership

```text
agent/
  AGENTS.md                  Global Pi instructions
  settings.json              UI, default model, package pins, discovery exclusions
  models.json                Model/provider definitions; environment-based secrets
  extensions/                Custom extensions and subagent display settings
  themes/                    paper-light theme
  skills/pdf-reader/         Owned PDF skill and scripts
  skills/<external>/         Generated links to pinned skill checkouts (ignored)
  external-skills/           Downloaded Git checkouts (ignored)
scripts/setup-pi.mjs          Installation and read-only validation
tests/                       Extension, PDF, setup, and resource-loading checks
external-skills.json          External repositories, immutable commits, skill paths
```

`.gitignore` ignores everything except explicitly listed portable files. Auth, sessions, caches, npm/git install stores, external checkouts, machine integrations, and Python/Node environments remain local. Add new owned files to the allowlist deliberately. The root `AGENTS.md` governs repository maintenance; `agent/AGENTS.md` supplies instructions to Pi in every project.

Versions live in `mise.toml` (Node), `package.json` (`piSetup.version` and development dependencies), `package-lock.json`, `agent/settings.json` (Pi packages), `agent/skills/pdf-reader/requirements.txt`, and `external-skills.json`. Pi supplies extension peer imports at runtime; matching development dependencies support standalone tests. `.npmrc` omits automatic peer installation.

External skills are owned by this Pi configuration. Setup links them directly into `agent/skills` from `agent/external-skills`, without writing to `~/.agents/skills`. The global skills exclusion in settings prevents Pi's automatic discovery of that shared directory from reintroducing removed or duplicate skills. Project-local skill discovery remains available.

## Resources

- `ask-user-question`: interactive single-choice, multi-choice, and free-text questions.
- `chrono-413-recovery`: omits images from completed turns in Chrono context and normalizes HTTP 413 for Pi's native compact-and-retry recovery. Keep compaction enabled.
- `notify`: desktop notifications when Pi needs input or finishes; test with `/notify-test` in TUI mode.
- `statusline`: responsive two-line footer showing model, tokens, context, and Git branch; use a Nerd Font for icons.
- `paper-light/dark`: the custom light theme paired with Pi's built-in dark theme according to terminal appearance.
- `pi-subagents`: child-agent delegation and background work; `/subagents-doctor` checks the installation. Display options live in `agent/extensions/subagent/config.json`.
- `pi-web-access`: web search and URL/PDF extraction. Provider-specific settings, keys, and caches remain local. Some providers and video features need additional credentials or tools; see its upstream documentation.
- `pdf-reader`: local PDF extraction, search, rendering, and visual reading.
- External skills: the selected Matt Pocock engineering/planning skills and Anthropic's frontend-design, pinned in the manifest.

When adding custom models, set `contextWindow` explicitly: `272000` when supported, or `160000` for Chrono. This is a configuration convention, not an override of built-in model windows.

## Validation

After edits, run `./setup-pi.sh`, `./setup-pi.sh --check`, and `npm test`. Tests use synthetic inputs and make no model requests. In a fresh interactive Pi session, verify the question UI, footer/theme, `/notify-test`, and `/subagents-doctor`. Provider and web requests require separate live checks.

## Migration

The September 2026 migration replaced `my-pi` package/configuration links with native resources in `~/.pi`, started a fresh Git history, and removed prompt snippets, plan/todo integration, thinking-steps, analyze-sessions, and find-skills from the managed configuration. The old repository is a backup, not the configuration source. Existing machine integrations and runtime data are preserved outside Git.

Selected resource files originated from pi-config revision `f82da563ab05d66729492d64c7ed4e96db3663f3`.
