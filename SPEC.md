# Receipts — Specification v0

A read-only auditor for AI instruction piles. Walks a repo's context surface —
`CLAUDE.md`, `skills/`, `agents/`, `commands/`, `.claude/` equivalents — and reports what it
costs to load, which copy of a duplicated rule wins, and which rules carry no receipt.
It measures. It never fixes, rewrites, or suggests rewordings.

Implementable without clarifying questions; open choices are marked `IMPL CHOICE`.

---

## 1. Definitions

- **Context unit**: one file that is (or can be) injected into a model's context: the root
  instruction file, each skill's `SKILL.md`, each agent/command definition.
- **Resident**: loaded every turn (root `CLAUDE.md` and anything it `@`-includes).
  **On-demand**: loaded when triggered (skills, commands). Classification is by location and
  include-graph, not by content.
- **Rule**: an imperative statement inside a context unit. v0 detects rules with heuristics
  (imperative verb at clause start; modal MUST/NEVER/ALWAYS/DO NOT; bulleted imperative).
  Precision over recall — undercounting rules is acceptable, miscounting non-rules as rules
  is not. `IMPL CHOICE`: exact heuristic set; document it in the report footer.
- **Receipt**: metadata answering three questions about a rule: what failure created it,
  who/what owns it, when it should be retested. v0 recognizes a receipt ONLY as a structured
  annotation adjacent to the rule: an HTML comment `<!-- receipt: {origin} | {owner} | {retest} -->`
  or a trailing ` [receipt: ...]`. Prose that happens to mention a date is not a receipt.
- **Duplicate rule pair**: two rules in different context units with normalized-token Jaccard
  similarity above 0.7 (`IMPL CHOICE`: threshold, but it must be printed in the report).

## 2. Invocation

```
receipts audit <repo-path> [--budget 40000] [--format text|json] [--max-files 500]
```

Exit codes: `0` = ran clean, `1` = ran with findings (any resident-over-budget or
unreceipted-rule count > 0), `2` = could not run (bad path, unreadable files). A check
that cannot run MUST exit 2, never 0 — no fail-open.

## 3. The report (text format)

Four sections, in this order, nothing else:

### 3.1 Load cost
Per context unit: file, resident/on-demand, bytes, estimated tokens (`IMPL CHOICE`:
bytes/4 is acceptable; state the method). Then: total resident tokens vs `--budget`, as a
number and a ratio. No adjectives — "4.9x budget", never "bloated".

### 3.2 Precedence conflicts
Each duplicate rule pair, with both file:line locations, the similarity score, and — where
the two copies differ materially in normalized text — the tag `DIVERGED`. The report states
which copy wins under the tool's precedence model (root file beats skill; later-in-file
beats earlier; `IMPL CHOICE`: document the model) and flags that this is the *tool's*
model, not a guarantee of runtime behavior.

### 3.3 Receipts
Count of rules with receipts vs without, per context unit. For unreceipted rules, list
file:line and the first 80 chars of the rule. For receipted rules whose `retest` date is
past, tag `RETEST_DUE`.

### 3.4 Dispositions
For each context unit (not each rule — unit granularity in v0), assign exactly one of six
dispositions, mechanically:

| disposition | trigger |
|---|---|
| `keep` | resident, has receipts on ≥ 50% of rules, no diverged duplicates |
| `one-home` | participates in diverged duplicate pairs (its rules exist elsewhere) |
| `load-later` | resident but no trigger words in root file reference it (`IMPL CHOICE`: heuristic) |
| `turn-into-check` | contains ≥ 3 rules matching mechanically-checkable patterns (number comparisons, file-must-exist, format assertions) |
| `probation` | zero receipts AND file mtime > 90 days old |
| `retire` | zero receipts AND zero inbound references AND on-demand |

Precedence when multiple triggers fire: `one-home` > `turn-into-check` > `retire` >
`probation` > `load-later` > `keep`. The disposition is a *recommendation heading*, and the
report says so in one fixed sentence — the tool never edits anything.

## 4. Hard constraints

- **Read-only.** The tool never writes inside the audited repo. Report goes to stdout or
  `--out <path>` outside the repo. Attempting to write into the repo is a defect.
- **No LLM calls.** All detection is lexical/structural. This keeps runs reproducible:
  same repo state → byte-identical report (modulo timestamp line).
- **Deterministic ordering.** Files walked in sorted path order; findings sorted by
  (file, line). Two runs must diff clean.
- **Size safety.** Files > 2 MB are skipped with a `SKIPPED` line naming them (never
  silently dropped — silent truncation reads as coverage).

## 5. Silent failures that MUST be caught

| failure | detection |
|---|---|
| Unreadable/binary file in scope | listed as `SKIPPED` with reason; exit stays honest |
| Include loop (`@a` includes `@b` includes `@a`) | cycle detected, reported once, no hang |
| Zero rules detected in a large instruction file | `SUSPECT_PARSE` warning — heuristics probably missed a format; better to admit blindness than report a false clean |
| Duplicate detection self-match | a rule never pairs with itself; same-file pairs allowed only across sections |
| Report written into audited repo | refused with exit 2 |

## 6. Acceptance

`fixtures/` contains three synthetic mini-repos with known ground truth
(`fixtures/*/EXPECTED.md`). The build is done when `receipts audit` on each fixture
produces findings matching its EXPECTED.md, and when a run on a real repo completes in
< 10 s for 500 files. The first real target is the operator's own vault repo — the tool
succeeds when that first report causes at least one line of the audited file to change,
which is measured outside the tool.

## 7. Out of scope for v0

Fixing, rewriting, or generating rules; kernel-split planning; git history mining for
receipt inference; per-rule dispositions; watching mode; any model call.
