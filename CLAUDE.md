# Receipts — repo instructions

You are implementing SPEC.md. Read it fully before writing code.

## Ground rules

- **The spec is the contract.** Ambiguity resolves toward refusing to run over running
  wrong, and toward admitting blindness (`SUSPECT_PARSE`, `SKIPPED`) over false cleans.
- **Do not read `fixtures/*/EXPECTED.md`.** Fixture repos themselves are inputs; the
  EXPECTED files are the holdout the runner grades against.
- **No LLM calls, no network.** Lexical and structural analysis only. Reports must be
  reproducible byte-for-byte.
- **Never write inside an audited repo.** Including fixtures. Including "helpfully."

## Stack

TypeScript CLI, Node ≥ 20, no framework. Dependencies allowed: a YAML parser and a glob
library; nothing else. Single binary entry `receipts`. Tests in vitest; acceptance is
`npm run fixtures`, which audits each fixture repo and diffs findings against EXPECTED.md.

## Definition of done

1. `receipts audit <path>` produces the four-section report of SPEC §3 in text and json.
2. Exit codes exactly per SPEC §2 — including exit 2 on can't-run (no fail-open).
3. `npm run fixtures` passes all three fixtures.
4. Two consecutive runs on the same input diff clean except the timestamp line.
5. The heuristic sets you chose (rule detection, similarity threshold, token estimate,
   precedence model) are printed in the report footer and documented in
   IMPLEMENTATION_NOTES.md.

## Style

Small modules: walk → classify → detect-rules → pair-duplicates → receipts → dispositions
→ render. Each stage pure, taking and returning plain data. Errors are values; the only
`process.exit` calls live in the entry file.
