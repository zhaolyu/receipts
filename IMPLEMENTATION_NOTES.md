# Implementation notes

Every `IMPL CHOICE` in [SPEC.md](SPEC.md), the reasoning behind it, and the places where the
build knows it is weak. Required by [CLAUDE.md](CLAUDE.md) definition of done #5.

All of these constants live in one file — [`src/heuristics.ts`](src/heuristics.ts) — and are
printed in the report footer. A heuristic you cannot see is not auditable.

---

## Resolved IMPL CHOICEs

### Token estimate — `bytes / 4`
Accepted from the spec's own suggestion. Stated in the footer and in the JSON output. Wrong for
CJK and for heavy code blocks; right enough for a budget ratio, which is the only thing it feeds.

### Similarity threshold — Jaccard `> 0.7` on normalized tokens
The spec's default, kept. Printed in the report as required. Strictly greater than, not
greater-or-equal: a pair sitting exactly on the threshold is not evidence.

### Normalization — lowercase → strip punctuation → drop stopwords → strip plural `-s`
The stopword and depluralize steps are additions, and they matter. Without them,
`ALWAYS cite the source document when quoting` and `ALWAYS cite sources when quoting` score
**0.5** and never pair — yet they are the same rule in two skills, which is exactly the finding
§3.2 exists to surface. With them, the pair scores 0.8 and is tagged `DIVERGED`.

Depluralization is a single trailing-`s` strip on tokens longer than three characters. Crude on
purpose: a real stemmer would be a dependency whose behavior this file would then also have to
document, and the crude version collapses the cases that actually occur.

### Rule detection — two heuristics, both narrow
A line is a rule when either:

1. it contains an **uppercase** modal as a whole word (`MUST`, `MUST NOT`, `NEVER`, `ALWAYS`,
   `DO NOT`, `SHALL`, `REQUIRED`, `FORBIDDEN`); or
2. it is a **list item** whose first word is one of 69 imperative verbs.

Free prose is never a rule unless it carries a modal — even when it opens with an imperative
verb. This is the sharpest interpretation of the spec's "precision over recall", and it is a
deliberate trade with a visible cost: `Use deploy for production pushes.` in a Notes paragraph is
an instruction, and this build does not count it.

The reason is downstream. Unreceipted-rule count drives both the §3.3 listing and the exit code.
Prose swept into the rule set inflates every one of those numbers, and an auditor whose counts
are inflated gets ignored — which is worse than one that undercounts and says so.

Lowercase `must` is treated as prose. `the build must be green` is a description of a state;
`the build MUST be green` is a rule. Requiring capitals is what makes heuristic 1 precise.

Frontmatter and fenced code blocks are excluded: a rule quoted inside an example is documentation
*about* a rule, not a rule.

### Receipts — two structured forms only
`<!-- receipt: {origin} | {owner} | {retest} -->` and `[receipt: {origin} | {owner} | {retest}]`.
Prose mentioning a date is not a receipt, per the spec, and there is a test for exactly that.
`retest` raises `RETEST_DUE` when it parses as an ISO date in the past; an unparseable retest
field is never due, on the grounds that guessing at a date format would invent findings.

### Precedence model
`root > included > rule > command > agent > skill`; within one unit, later-in-file beats earlier;
ties between equal-rank units go to the lexicographically-first path.

That last tiebreak is arbitrary, and the report says so directly, along with the reminder that
this is the tool's model and not a claim about how any runtime resolves anything. An auditor
cannot know a host's real precedence, and pretending otherwise would be the most damaging thing
this report could do.

### `load-later` heuristic
Fires when a unit is resident, is not itself a root file, and no root file's text names it — by
path, by skill directory name, or by frontmatter `name`.

### `turn-into-check` patterns
Six named patterns: `numeric-comparison`, `numeric-with-unit`, `absence-assertion`,
`universal-assertion`, `path-existence`, `format-assertion`. A unit with ≥ 3 matching rules gets
the disposition. Names are printed in the footer; regexes are in `src/heuristics.ts`.

### `SUSPECT_PARSE` threshold — 2,000 bytes
The spec says "a large instruction file" and does not define large. A file at or above 2 KB with
zero detected rules raises the warning.

This fires on Forge's own `AGENTS.md`, which states its rules in tables and prose rather than
modal bullets. That is the warning working: the heuristics genuinely cannot see those rules, and
saying so is better than reporting a clean file.

### Scope of the walk
A file is a candidate when it sits at the repo root or under a context directory
(`.claude`, `.agents`, `.cursor`, `.github`, `skills`, `agents`, `commands`, `rules`, `prompts`)
at any depth, and its extension is not a known asset type.

**Unknown extensions are candidates on purpose.** `blob.bin` next to a `CLAUDE.md` is precisely
the file an audit must not pretend it read: the tool attempts it, fails on size or on a NUL byte,
and prints a `SKIPPED` line. Inferring from the extension that it was uninteresting would be the
silent-coverage failure the spec forbids.

Readable candidates that are not recognized context units (an ordinary `SETUP.md`, say) are
ignored without comment. They are documents in the tree, not context surface.

### Exit codes
`findings` counts exactly the two conditions SPEC §2 names — resident-over-budget, and
unreceipted-rule count > 0. Skips, cycles, and `SUSPECT_PARSE` are reported but do not by
themselves make a run "found something": they describe the audit's own coverage, not the audited
repo's state. Anything that prevents the audit from running exits 2, never 0.

---

## Deviations and tensions worth naming

### Writing into fixtures
[CLAUDE.md](CLAUDE.md) says never write inside an audited repo, "including fixtures".
`fixtures/broken-repo/SETUP.md` says the fixture runner must generate `blob.bin` if absent.

Resolved by splitting the two roles: **`receipts audit` never writes anywhere except `--out`**,
and refuses even that when the target resolves inside the audited repo (exit 2, with a test).
The *fixture runner* — a separate script, not the auditor — does the setup `SETUP.md` asks for,
before any audit begins. The generated file stays gitignored.

### The fixture grader cannot be written against a format it may not read
`fixtures/*/EXPECTED.md` is the holdout. The grader therefore assumes no format. It extracts
assertions from whatever prose is there, using a closed vocabulary of finding tokens this tool
already emits (`SKIPPED`, `DIVERGED`, disposition names, exit codes, file names, counts), and
checks each against the real report.

Two properties, both deliberate:

- On failure it prints the unmet assertion key and the **actual** value only — never the expected
  value, never a line of `EXPECTED.md`. A failing test run must not become a way to read the
  holdout.
- An `EXPECTED.md` with no interpretable assertion **fails** rather than passes. Silently passing
  an unparsed expectation is the false-clean this whole tool exists to refuse.

All three fixtures passed on the first run under this grader, with the holdout unread.

### Zero runtime dependencies
The spec allows a YAML parser and a glob library. This build uses neither: the directory walk is
hand-written (which it had to be anyway, for deterministic sorted order and the `--max-files`
cap), and the only YAML that matters is a flat frontmatter `name:` field, read with one regex.

The gain is that "same repo state → byte-identical report" depends on nothing but Node. Dev
dependencies (TypeScript, vitest) are unchanged.

Node ≥ 22.18 runs the TypeScript sources directly via type stripping, so there is no build step
and no compiled artifact to drift from source.

---

## Known weaknesses

| Weakness | Consequence | Where it should go |
| --- | --- | --- |
| `probation` keys on file mtime | A fresh `git clone` resets every mtime, so probation silently stops firing on CI and on any new machine. **The most fragile rule in the build.** | Git-history-derived age; explicitly out of scope in v0 §7 |
| No `.gitignore` awareness | Auditing Forge walked 11,791 candidates — into gitignored child repos and agent worktrees — and hit the 500-file cap. Reported honestly, but the ratio is meaningless at that scale | v1: skip gitignored paths by default |
| Rule detection misses table-stated and prose-stated rules | `SUSPECT_PARSE` fires and the count is honest, but a repo that writes rules in tables gets a near-empty audit | v1: a table-row heuristic, gated on precision |
| Duplicate pairing is O(n²) over rules | 808 rules → ~326k comparisons, still under 500 ms. It will not stay linear-ish forever | Only if a real repo makes it slow |
| `inboundRefs` is a text search | A skill named `next` or `graph` matches common English and looks referenced when it is not | Tighten to link-and-path syntax if `retire` starts under-firing |

## Measured

- Forge (500-file cap reached, 81 context units, 808 rules): **494 ms**. Spec asks < 10 s for 500
  files.
- `npm run verify`: typecheck clean, 39 tests passing, 3/3 fixtures.
