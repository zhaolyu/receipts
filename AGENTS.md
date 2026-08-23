# AGENTS.md — receipts

Repository router for Forge slug `receipts`.

**verify**: `npm run verify`

Status: **v0 in progress.** `npm run verify` = typecheck + unit tests + fixture acceptance.

## Contract

- `SPEC.md` is the contract. Where spec and instinct disagree, the spec wins.
- `CLAUDE.md` holds the build ground rules for the implementing agent. Read it
  before writing code, and treat its holdout boundaries as hard.
- Record every `IMPL CHOICE` you resolve in `IMPLEMENTATION_NOTES.md`.
- `ROADMAP.md` holds the post-v0 evolution path. v0 scope is closed; ideas land
  there, not in the build.

<!-- forge-agent-baseline:v1 begin -->
## Forge agent baseline

This child repository is an independent Git root. Do not assume the parent
Forge `AGENTS.md` was loaded.

- Never commit secrets, environment files, keys, tokens, or credential-bearing
  configuration. Stop and identify the exact file if one appears.
- Never commit, amend, bypass hooks, force-push, or push unless the user
  explicitly authorizes that specific action.
- Run this repository's declared verify command — the `**verify**` line near the
  top of this file — before claiming implementation work is complete. If it
  reads `none`, there is nothing to run. Scope tests to the touched path when
  you know it.
- Keep changes within this repository unless the task explicitly requires a
  cross-repo change.
- Report the commands run, their outcomes, and anything skipped.
<!-- forge-agent-baseline:v1 end -->
