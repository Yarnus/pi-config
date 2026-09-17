# Global Agent Instructions

## Scope

- Apply these instructions to all projects unless more specific project-level instructions override them.
- Inspect relevant code, tests, documentation, and local conventions before editing. Prefer established project patterns over introducing new ones.
- Treat project instructions and task-specific skills as more specific guidance than this file.

## Before Changing Code

- Resolve ambiguities that materially affect the implementation instead of guessing.
- State assumptions only when they affect the solution.
- Prefer the simplest approach that satisfies the request, and point out unnecessary complexity.
- For substantial or risky multi-step work, provide a brief plan in the form `1. [Step] -> verify: [check]`.

## Approved-plan execution

- In the parent session, keep planning and design decisions on the current model. After plan approval and a request to implement, implement in the parent by default. Use `plan-executor` through `pi-subagents` only when the user explicitly requests it; follow an explicit request for another executor instead. Planning or plan approval alone does not select an executor or authorize implementation.
- For a delegated handoff, supply the approved plan's path, repository cwd, assigned scope, key files or symbols, confirmed findings and settled decisions, acceptance criteria, and exact validation commands when known. If the plan exists only in conversation, save it to an agreed file before handoff; no fixed filename or separate log is required.
- Assign a coherent implementation scope to one executor rather than launching a fresh executor for each tightly related step. Keep one writer per working tree.
- Use the executor's configured model and thinking level without per-run overrides. If it is unavailable, report the blocker rather than silently switching models or implementing in the parent.
- Resolve executor escalations within the approved design; obtain user approval for material plan changes. Before accepting completion, inspect the actual diff and validation evidence; supplement missing, stale, suspect, or high-risk evidence rather than routinely repeating the executor's full investigation and checks.
- These are parent-session routing rules, not instructions for child agents to delegate.

## Implementation

- Make the minimum change required to satisfy the request.
- Avoid unrelated refactoring, formatting, features, configurability, compatibility layers, and speculative error handling.
- Preserve unrelated working-tree changes. Never revert or overwrite user work without explicit permission.
- Follow the existing architecture and style even when another approach would also work.
- Remove imports, variables, helpers, and files made unused by the current change.
- Mention unrelated problems without changing them.
- Prefer explicit behavior, a single source of truth, and fewer special cases.

## Verification

- For bug fixes, reproduce the failure before fixing it when practical, then make the reproduction pass.
- For validation changes, cover meaningful invalid inputs.
- For refactors, identify the behavior that must remain unchanged and verify it before and after when practical.
- Test observable behavior at the narrowest useful level while iterating, then run broader relevant checks when practical.
- Use the repository's documented formatter, compiler, linter, type checker, and test commands rather than inventing commands.
- If the strongest verification is unavailable, run the strongest practical check and report what remains unverified.

## Skills

- Before substantial implementation or review work, check whether an available skill clearly matches the task.
- Load only the relevant skill and follow it as task-specific guidance. Do not load every skill preemptively.

## Communication

- Reply in Chinese unless the user requests another language.
- Write repository content, code comments, identifiers, commit messages, pull request descriptions, and documentation in English unless the repository already uses another language.
- Start with the direct answer or action. Keep simple answers short and substantial work structured.
- Explain known root causes and material tradeoffs without presenting uncertainty as fact.
- Keep code comments short and use them only for non-obvious behavior.
- In the final response, summarize the changes, list the verification actually performed, and state any remaining limitation or unrun check.

## Code Review

- Present findings first, ordered by severity, with concrete file and line references.
- Prioritize correctness, security, behavioral regressions, fragile design, and missing tests.
- Look for duplication, obscurity, circular dependencies, unnecessary complexity, and state with multiple sources of truth.
- Suggest a cleaner design only when it addresses a concrete problem.
- If there are no findings, say so and identify any remaining test gap or residual risk.

## Architecture Documentation

- Update nearby architecture documentation only when a change materially affects documented structure, ownership, module responsibilities, or dependency boundaries.
- Keep documentation changes limited to the affected area and concise enough to maintain.
