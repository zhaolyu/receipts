# receipts — evolution path

v0 is built and its acceptance passes. [SPEC.md](SPEC.md) §7 lists what v0 does not do; this file
says what comes after, in what order, and what has to be true first.

**The governing constraint:** every item below must preserve the four properties that make the
report trustworthy — read-only, no model calls, deterministic, no silent truncation. An item that
cannot be built without breaking one of those does not get built.

---

## E1 — Respect `.gitignore`

**Gate:** none. This is the first real finding from the first real run, and it is next.

Auditing Forge walked **11,791 candidate files** and hit the 500-file cap, because it descended
into gitignored child repos and agent worktrees. The cap was reported honestly — no silent
truncation — but a ratio computed over an arbitrary first 500 files is not a measurement.

- Skip gitignored paths by default; `--no-respect-gitignore` to restore current behavior.
- Keep the `MAX_FILES_REACHED` note; it should just stop firing on ordinary repos.
- Determinism is unaffected: gitignore evaluation is a pure function of tracked files on disk.

## E2 — Rule detection that sees tables

**Gate:** E1 shipped, plus ≥ 3 real repos audited where `SUSPECT_PARSE` fired.

It already fired on Forge's own `AGENTS.md`, which states its rules in tables and prose rather
than modal bullets. The warning did its job — the audit admitted blindness instead of reporting a
clean file — but a repo that writes rules in tables currently gets a near-empty report.

Add one heuristic: a table row is a rule when a cell carries a modal or opens with an imperative
verb, and the row sits in a table whose header names a rule-like column.

**Gate it on precision, not enthusiasm.** The v0 trade — free prose is never a rule — is the
reason the unreceipted counts are believable. Any new heuristic must be measured against the
fixtures before it lands, and the footer must name it.

## E3 — Per-rule dispositions

**Gate:** ≥ 10 real audits where the unit-level disposition was the wrong granularity, recorded
as actual examples rather than a hunch.

v0 assigns dispositions per context unit, deliberately: a file is a thing you can move, and a
rule usually isn't. But a 40-rule `CLAUDE.md` where three rules are duplicated elsewhere gets
`one-home` for the whole file, which over-claims.

If built, the unit-level disposition stays and the per-rule one is additive. Two competing
recommendations for the same file with no stated relationship would be worse than one coarse one.

## E4 — Git-history receipt inference

**Gate:** E1–E2 shipped and a repo has ≥ 50 rules with receipts written by hand.

The obvious idea — mine `git log` and infer a rule's origin from the commit that added it — is
listed out of scope in v0 §7, and the reason is worth preserving: **an inferred receipt is not a
receipt.** The value of the annotation is that a human decided this rule was worth keeping and
named the failure. A commit hash is provenance, not justification.

If it is ever built, the output must be a *suggestion channel* that is visibly distinct from a
real receipt — never written into the audited repo (the read-only rule is absolute), never
counted in the receipted total, and never able to clear an `UNRECEIPTED` finding.

Hold this one until the hand-written convention has proven it works. It is the item most likely
to quietly destroy the metric it is trying to improve.

## E5 — Watch mode / CI check

**Gate:** the tool has been run on the same repo ≥ 10 times and the numbers have moved.

Exit codes are already CI-shaped: `0` clean, `1` findings, `2` cannot run. What is missing is a
useful failure threshold — no team wants to fail a build on the first unreceipted rule.

- `--max-unreceipted N` and `--fail-on <over-budget|unreceipted|none>`.
- A baseline file so CI fails on *new* findings rather than the existing pile — the only way this
  is adoptable on a repo that already has 808 unreceipted rules.

The baseline file lives outside the audited repo, or the read-only rule breaks. That constraint
is real, awkward, and non-negotiable.

## E6 — Diff mode

**Gate:** E5 shipped.

`receipts audit --since <ref>` — report only findings whose rules changed since a ref. Pairs with
the CI check and makes the tool useful on a pull request instead of only on a repo.

Requires reading git history for changed line ranges. That is a read, not a write, and stays
inside the constraints.

---

## The measurement that decides whether any of this matters

SPEC §6 sets the real bar: **the first report causes at least one line of the audited file to
change.** Measured outside the tool.

First real audit, Forge, 2026-08-23: 81 context units, 808 rules, **0 with receipts**, 1,383
duplicate pairs, 97 diverged. Nothing has changed as a result yet.

If the second audit of the same repo shows the same numbers, the honest conclusion is that this
is a tool nobody acts on, and the roadmap above is worth nothing. Check that before building E1.

---

## Ideas considered and rejected

| Idea | Why not |
| --- | --- |
| Auto-fix duplicated rules | The tool would have to decide which wording wins. It cannot know, and its precedence model is explicitly labeled as *its* model, not the runtime's. A wrong auto-fix is worse than a report |
| LLM-scored rule quality | Kills byte-identical reproducibility, the property that lets two runs be diffed. Also unfalsifiable: nobody can check the score |
| Rewrite suggestions | "It measures. It never fixes, rewrites, or suggests rewordings." The moment it suggests, every finding becomes an argument about phrasing instead of a number |
| Kernel-split planning | Out of scope in v0 §7 and should stay out. Deciding which rules form a minimal kernel is a judgment call about the repo's purpose, which the tool has no access to |
| Semantic embedding for duplicates | Needs a model, kills determinism, and the lexical version already surfaces the diverged pairs that matter. Revisit only if a real audit misses an obvious duplicate |
| Config file for heuristics | Every knob is a way to tune findings until they are comfortable. Heuristics live in one source file, printed in the footer, changed by a commit that shows up in review |
