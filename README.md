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

`--check` performs no installations or file changes. It checks versions, direct Node dependencies, PDF dependencies, Pi packages, and external skill checkout origins, cleanliness, and discovery links (offline, without checking remote freshness). It does not verify credentials, network services, or terminal appearance. Start a fresh Pi process after resource changes.

## Layout and ownership

```text
agent/
  AGENTS.md                  Global Pi instructions
  settings.json              UI, default model, package pins, discovery exclusions
  models.json                Model/provider definitions; environment-based secrets
  extensions/                Custom extensions and subagent display settings
  themes/                    paper-light and paper-dark themes
  agents/plan-executor.md    Approved-plan implementation role
  skills/pdf-reader/         Owned PDF skill and scripts
  skills/<external>/         Generated links to default-branch skill checkouts (ignored)
  external-skills/           Downloaded Git checkouts (ignored)
scripts/setup-pi.mjs          Installation and read-only validation
tests/                       Extension, PDF, setup, and resource-loading checks
external-skills.json          External repositories and skill paths
```

`.gitignore` ignores everything except explicitly listed portable files. Auth, sessions, caches, npm/git install stores, external checkouts, machine integrations, and Python/Node environments remain local. Add new owned files to the allowlist deliberately. The root `AGENTS.md` governs repository maintenance; `agent/AGENTS.md` supplies instructions to Pi in every project.

Versions live in `mise.toml` (Node), `package.json` (`piSetup.version` and development dependencies), `package-lock.json`, `agent/settings.json` (Pi packages), and `agent/skills/pdf-reader/requirements.txt`. Pi supplies extension peer imports at runtime; matching development dependencies support standalone tests. `.npmrc` omits automatic peer installation.

External skills are owned by this Pi configuration. Every setup run fetches each repository's remote `HEAD` and fast-forwards to its default branch, without assuming `main` or `master`. Modified checkouts, local commits, and diverged histories are preserved and reported instead of reset. Checkouts live under `agent/external-skills/<owner>/<repo>`; clean legacy commit-based links are migrated while old checkouts are retained. Setup links them directly into `agent/skills` from `agent/external-skills`, without writing to `~/.agents/skills`. The global skills exclusion in settings prevents Pi's automatic discovery of that shared directory from reintroducing removed or duplicate skills. Project-local skill discovery remains available.

## Resources

- `ask-user-question`: interactive single-choice, multi-choice, and free-text questions.
- `chrono-413-recovery`: omits images from completed turns in Chrono context and normalizes HTTP 413 for Pi's native compact-and-retry recovery. Keep compaction enabled.
- `notify`: desktop notifications with the fixed title `Pi Agent` and task-aware Herdr sidebar metadata. Sidebar task labels use the Pi session name (`/name`), otherwise the active branch's first useful user-message preview (excluding image paths), then the project name. No additional model requests or generated-name persistence. Result notification bodies include the status and final reply/error preview, capped at 60 Unicode code points including the ellipsis (approximately two lines; actual wrapping is OS-controlled). Confirmation and compaction-failure bodies retain a 220-character limit. On macOS inside Herdr, notifications go directly to a uniquely identified WezTerm host TTY; ambiguous/unavailable routing falls back to macOS notifications (without terminal click focus). Test with `/notify-test`. Herdr's managed lifecycle integration remains untouched.
  - Local Herdr setup: set `[ui.toast] delivery = "off"` to avoid duplicate popups (this disables Herdr popups for all agents), and set `[ui.sidebar.agents.rows_by_agent] pi = [["agent", "state_icon", "state_text"], ["$task"], ["workspace"]]`. Use Herdr's UI `reload config` action to refresh both client presentation settings and server configuration, then restart Pi. Other agents keep their existing sidebar layout. Notification text is visible to the OS notification center.
- `plan-mode`: small adaptation of Pi's official plan-mode example. **Tab toggles Plan / Build only when the main editor is exactly empty**; any content (including whitespace) preserves normal Tab completion. `@` and Shift+Tab are unchanged. `/plan` also toggles. Switching is refused while Pi is busy; finish or abort the run, then try again. Plan shows a compact widget (the custom footer hides extension statuses); returning to Build clears it and restores the exact prior active tools. Mode follows session branches across resume/reload/tree navigation; switching to Build does not automatically execute a plan.
- `statusline`: responsive two-line footer showing model, tokens, context, and Git branch; use a Nerd Font for icons.
- `paper-light/paper-dark`: custom light/dark themes selected automatically according to terminal appearance. Based on [Kanagawa Paper](https://github.com/thesimonho/kanagawa-paper.nvim/tree/ecf19801a2673054c19421d82b766f7641688320) Canvas / Ink palettes (`colors.lua` and `themes/{canvas,ink}.lua`). Syntax maps to upstream `comment`, `keyword`, `fun`, `parameter`, `string`, `number`, `type`, `operator`, and `punct`; Pi combines variable/parameter styling, so both use the neutral parameter color. Canvas and Ink syntax colors are unchanged from upstream, preserving their intentionally soft contrast rather than enforcing a 4.5:1 syntax contrast target. Canvas footer and diff colors also use the unmodified upstream palette rather than a 4.5:1 contrast target; body text and scrollbar thumbs retain darker foregrounds for legibility. Ink footer colors retain their contrast adjustments. Terminal page backgrounds remain terminal-controlled; matching Canvas/Ink backgrounds are `#e1e1de` / `#1f1f28`.
- `pi-subagents`: child-agent delegation and background work; `/subagents-doctor` checks the installation. Display options live in `agent/extensions/subagent/config.json`.
- `pi-permissive`: permissive regex-based gates for `bash`, `read`, `write`, and `edit`. Most operations run silently; selected destructive commands and credential writes are denied, while risky Git operations and sensitive file access require confirmation (blocked without UI). Uses upstream defaults; not a security sandbox or coverage for arbitrary tools and shell scripts.
- `pi-web-access`: web search and URL/PDF extraction. Provider-specific settings, keys, and caches remain local. Some providers and video features need additional credentials or tools; see its upstream documentation.
- `@juicesharp/rpiv-todo`: agent-maintained session task list and live progress panel; `/todos` shows the list. The parent agent owns plan updates; subagent execution status remains with `pi-subagents`.
- `@narumitw/pi-btw`: `/btw <question>` opens a temporary side thread using the current model by default. Answers stay outside the main conversation unless explicitly brought back; retained threads are discarded on reload or restart.
- `pdf-reader`: local PDF extraction, search, rendering, and visual reading.
- External skills: the selected Matt Pocock engineering/planning skills Anthropic's frontend-design, and Elixir/Phoenix essentials, declared in the manifest and following upstream default branches.

### Approved-plan execution

Use your preferred planning skill on the current parent model, save the plan to a file, then ask: "The plan at `<path>` is approved; have plan-executor implement it." Global `agent/AGENTS.md` routes approved-plan implementation through `pi-subagents`; `agent/agents/plan-executor.md` defines the execution constraints. No extra workflow skill, fixed plan filename, digest, or dedicated log is required.

The executor follows the approved scope, validates each step, and escalates design contradictions to the parent. The parent owns design decisions and final acceptance. Its model is `chrono/gpt-5.6-luna` / `max`, configured under `subagents.agentOverrides.plan-executor` in `agent/settings.json`; ordinary worker and parent defaults are unchanged. These are instruction-based boundaries, not a file-permission sandbox.

Plan Mode blocks saving files and dispatching subagents; switch to Build first. Switching modes does not approve implementation. Start a fresh Pi process after resource changes and inspect `/subagents-models plan-executor`. Live provider support for the thinking level needs a separate smoke check.

### Plan mode limits

Plan mode allows only already-active `read`, `grep`, `find`, `ls`, `bash`, `ask_user_question`, `web_search`, `fetch_content`, and `get_search_content`. Other model tools, including write/edit, subagents, shell helpers, and TODO mutation, are blocked. It adds planning guidance without extracting plans or owning the existing TODO list.

Bash accepts a conservative subset of single literal inspection commands: `cat`, `head`, `tail`, `wc`, `ls`, `pwd`, `rg`, `grep`, and `git status` / `git log`. Examples: `head -n 80 README.md`, `rg -n 'pattern' src`, `rg -g '*.ts' pattern .`, `git status --short`, `git log --oneline -10`. Options are restricted; pipes, redirection, substitutions, compound commands, unquoted globs, and user `!` / `!!` execution are blocked. Ripgrep config and Git pager/external-diff/signature helpers are disabled for allowed queries. Use dedicated inspection tools or switch to Build for unsupported commands.

This is a workflow guard, **not a security sandbox**. Trusted tool implementations, executable lookup/shell startup, other extensions and their slash commands, already-running background agents, and network fetch/search may have side effects. Stop background work before planning when necessary; Plan cannot revoke work already launched.

When adding custom models, set `contextWindow` explicitly: `272000` when supported, or `160000` for Chrono. This is a configuration convention, not an override of built-in model windows.

## Validation

After edits, run `./setup-pi.sh`, `./setup-pi.sh --check`, and `npm test`. Tests use synthetic inputs and make no model requests. In a fresh interactive Pi session, verify the question UI, footer/theme, `/notify-test`, and `/subagents-doctor`. Check Plan with empty-input Tab, nonempty path completion (including whitespace), unchanged `@` / Shift+Tab, the Plan widget, busy-run refusal, and `/plan` fallback. Provider and web requests require separate live checks.

## Migration

The September 2026 migration replaced `my-pi` package/configuration links with native resources in `~/.pi`, started a fresh Git history, and removed prompt snippets, plan/todo integration, thinking-steps, analyze-sessions, and find-skills from the managed configuration. The old repository is a backup, not the configuration source. Existing machine integrations and runtime data are preserved outside Git.

Selected resource files originated from pi-config revision `f82da563ab05d66729492d64c7ed4e96db3663f3`.
