# Pi dotfiles

Personal Pi configuration, maintained directly in `~/.pi` as a Git repository. Pi discovers custom resources under `agent/`; there is no local package registration or configuration link to another repository.

## Install

Install Pi separately, then clone this repository to `~/.pi`. If that directory already contains configuration or runtime data, back it up and merge deliberately; preserve local credentials and sessions. After cloning, fetch the selected third-party Git skills and start Pi:

```bash
cd ~/.pi
pi update --extensions
pi
```

Pi reads the owned extensions, themes, instructions, and PDF skill directly from `agent/`. `pi update --extensions` clones the configured Git skill packages and updates them to their upstream default branches. The pinned npm packages are not installed by this update command: Pi installs missing packages when it starts. Both steps require network access on a fresh machine. No repository setup script or Node/Python environment is needed to start Pi. The PDF skill's Python environment is created on first use according to its `SKILL.md`.

Provide `CHRONO_KEY` through your shell environment or secret manager. For providers supporting interactive authentication, use `/login`. Credentials and session history remain local, outside Git. Restart Pi after changing resources.

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
  git/                       Pi-managed Git packages (ignored)
```

`.gitignore` ignores everything except explicitly listed portable files. Auth, sessions, caches, npm/git install stores, external checkouts, machine integrations, and Python/Node environments remain local. Add new owned files to the allowlist deliberately. The root `AGENTS.md` governs repository maintenance; `agent/AGENTS.md` supplies instructions to Pi in every project.

Versions live in `agent/settings.json` (pinned npm packages and unpinned Git skill packages), `package-lock.json` (optional test dependencies), and `agent/skills/pdf-reader/requirements.txt` (PDF tooling). Pi supplies extension imports at runtime; this repository does not pin or install the Pi executable.

Pi downloads the Matt Pocock and Anthropic skill repositories into its ignored `agent/git/` store. Filters in `agent/settings.json` enable only the selected skills; Pi still clones each whole repository. Git sources follow upstream's default branch when `pi update --extensions` runs, so review upstream changes before updating. The `grilling` skill replaces the upstream `grill-me` and `grill-with-docs` wrappers, which require a Skill tool not provided by Pi. The global skills exclusion in settings prevents Pi's automatic discovery of `~/.agents/skills/` from reintroducing removed or duplicate skills. Project-local skill discovery remains available.

## Resources

- `ask-user-question`: interactive single-choice, multi-choice, and free-text questions.
- `chrono-413-recovery`: omits images from completed turns in Chrono context and normalizes HTTP 413 for Pi's native compact-and-retry recovery. Keep compaction enabled.
- `notify`: desktop notifications with the fixed title `Pi Agent`. Kitty is the current terminal: when `KITTY_WINDOW_ID` is present, notifications use Kitty's OSC 99 protocol directly, with no host-TTY lookup or sidebar integration. Windows Terminal uses Windows toast notifications; other terminals receive OSC 777 if supported. Notifications fire for confirmation prompts, compaction failures, and settled runs (not intermediate retries). Result bodies include the status and final reply/error preview, capped at 60 Unicode code points including the ellipsis; confirmation and compaction-failure bodies retain a 220-character limit. Actual wrapping and delivery depend on the terminal and OS notification permissions. Test with `/notify-test` in a fresh Kitty Pi session. Notification text is visible to the OS notification center.
- `plan-mode`: small adaptation of Pi's official plan-mode example. **Tab toggles Plan / Build only when the main editor is exactly empty**; any content (including whitespace) preserves normal Tab completion. `@` and Shift+Tab are unchanged. `/plan` also toggles. Switching is refused while Pi is busy; finish or abort the run, then try again. Plan shows a compact widget (the custom footer hides extension statuses); returning to Build clears it and restores the exact prior active tools. Mode follows session branches across resume/reload/tree navigation; switching to Build does not automatically execute a plan.
- `statusline`: responsive two-line footer showing model, tokens, context, and Git branch; use a Nerd Font for icons.
- `paper-light/paper-dark`: custom light/dark themes selected automatically according to terminal appearance. Based on [Kanagawa Paper](https://github.com/thesimonho/kanagawa-paper.nvim/tree/ecf19801a2673054c19421d82b766f7641688320) Canvas / Ink palettes (`colors.lua` and `themes/{canvas,ink}.lua`). Syntax maps to upstream `comment`, `keyword`, `fun`, `parameter`, `string`, `number`, `type`, `operator`, and `punct`; Pi combines variable/parameter styling, so both use the neutral parameter color. Canvas and Ink syntax colors are unchanged from upstream, preserving their intentionally soft contrast rather than enforcing a 4.5:1 syntax contrast target. Canvas footer and diff colors also use the unmodified upstream palette rather than a 4.5:1 contrast target; body text and scrollbar thumbs retain darker foregrounds for legibility. Ink footer colors retain their contrast adjustments. Terminal page backgrounds remain terminal-controlled; matching Canvas/Ink backgrounds are `#e1e1de` / `#1f1f28`.
- `pi-subagents`: child-agent delegation and background work; `/subagents-doctor` checks the installation. Display options live in `agent/extensions/subagent/config.json`.
- `pi-permissive`: permissive regex-based gates for `bash`, `read`, `write`, and `edit`. Most operations run silently; selected destructive commands and credential writes are denied, while risky Git operations and sensitive file access require confirmation (blocked without UI). Uses upstream defaults; not a security sandbox or coverage for arbitrary tools and shell scripts.
- `pi-web-access`: web search and URL/PDF extraction. Provider-specific settings, keys, and caches remain local. Some providers and video features need additional credentials or tools; see its upstream documentation.
- `@juicesharp/rpiv-todo`: agent-maintained session task list and live progress panel; `/todos` shows the list. The parent agent owns plan updates; subagent execution status remains with `pi-subagents`.
- `@narumitw/pi-btw`: `/btw <question>` opens a temporary side thread using the current model by default. Answers stay outside the main conversation unless explicitly brought back; retained threads are discarded on reload or restart.
- `pdf-reader`: local PDF extraction, search, rendering, and visual reading.
- Git-managed skills: selected Matt Pocock engineering/planning skills and Anthropic's frontend-design. Elixir/Phoenix essentials are provided by the configured Pi package.

### Approved-plan execution

Use your preferred planning skill on the current parent model, save the plan to a file, then ask: "The plan at `<path>` is approved; have plan-executor implement it." Global `agent/AGENTS.md` keeps approved-plan implementation in the parent by default and delegates only on explicit request; `agent/agents/plan-executor.md` defines the execution constraints for that delegation. No extra workflow skill, fixed plan filename, digest, or dedicated log is required.

The executor follows the approved scope, validates each step, and escalates design contradictions to the parent. The parent owns design decisions and final acceptance. Its model is `openai-codex/gpt-6-luna` / `max`, configured under `subagents.agentOverrides.plan-executor` in `agent/settings.json`; ordinary worker and parent defaults are unchanged. These are instruction-based boundaries, not a file-permission sandbox.

Plan Mode blocks saving files and dispatching subagents; switch to Build first. Switching modes does not approve implementation. Start a fresh Pi process after resource changes and inspect `/subagents-models plan-executor`. Live provider support for the thinking level needs a separate smoke check.

### Plan mode limits

Plan mode allows only already-active `read`, `grep`, `find`, `ls`, `bash`, `ask_user_question`, `web_search`, `fetch_content`, and `get_search_content`. Other model tools, including write/edit, subagents, shell helpers, and TODO mutation, are blocked. It adds planning guidance without extracting plans or owning the existing TODO list.

Bash accepts a conservative subset of single literal inspection commands: `cat`, `head`, `tail`, `wc`, `ls`, `pwd`, `rg`, `grep`, and `git status` / `git log`. Examples: `head -n 80 README.md`, `rg -n 'pattern' src`, `rg -g '*.ts' pattern .`, `git status --short`, `git log --oneline -10`. Options are restricted; pipes, redirection, substitutions, compound commands, unquoted globs, and user `!` / `!!` execution are blocked. Ripgrep config and Git pager/external-diff/signature helpers are disabled for allowed queries. Use dedicated inspection tools or switch to Build for unsupported commands.

This is a workflow guard, **not a security sandbox**. Trusted tool implementations, executable lookup/shell startup, other extensions and their slash commands, already-running background agents, and network fetch/search may have side effects. Stop background work before planning when necessary; Plan cannot revoke work already launched.

When adding custom models, set `contextWindow` explicitly: `272000` when supported, or `160000` for Chrono. This is a configuration convention, not an override of built-in model windows.

## Validation

For resource changes, run `npm ci --omit=peer` and `npm test` (Node is required only for these development checks). In a fresh interactive Pi session, verify the question UI, footer/theme, `/notify-test`, and `/subagents-doctor`. Check Plan with empty-input Tab, nonempty path completion (including whitespace), unchanged `@` / Shift+Tab, the Plan widget, busy-run refusal, and `/plan` fallback. Provider and web requests require separate live checks.

## Migration

The September 2026 migration replaced `my-pi` package/configuration links with native resources in `~/.pi`, started a fresh Git history, and removed prompt snippets, plan/todo integration, thinking-steps, analyze-sessions, and find-skills from the managed configuration. The old repository is a backup, not the configuration source. Existing machine integrations and runtime data are preserved outside Git.

Selected resource files originated from pi-config revision `f82da563ab05d66729492d64c7ed4e96db3663f3`.
