# receipts

A read-only auditor for AI instruction piles.

Walks a repo's context surface — `CLAUDE.md`, `skills/`, `agents/`, `commands/`, `.claude/`
equivalents — and reports what it costs to load, which copy of a duplicated rule wins, and which
rules carry no receipt.

**It measures. It never fixes, rewrites, or suggests rewordings.**

```bash
receipts audit . --budget 40000
```

---

## Why

Instruction files grow by accretion. Every incident adds a line; nothing ever removes one. After
a year you have a `CLAUDE.md` nobody has read end to end, three skills that say almost the same
thing in slightly different words, and no way to tell which rules are load-bearing and which are
scar tissue from a problem that no longer exists.

`receipts` answers four questions, mechanically:

1. **What does this cost to load, every turn?**
2. **Which rules exist in more than one place, and do the copies still agree?**
3. **Which rules can say what failure created them, who owns them, and when to retest?**
4. **Given the above, what is the mechanical recommendation for each file?**

The third one is the name. A rule with a receipt earned its place. A rule without one might have
too — but nobody can tell any more, and that is the finding.

## Install

Requires Node ≥ 22.18 (the sources run directly via type stripping — no build step).

```bash
git clone git@github.com:zhaolyu/receipts.git && cd receipts && npm install
```

Then either `npm run receipts -- audit <path>` or `node bin/receipts.ts audit <path>`.

## Usage

```
receipts audit <repo-path> [--budget 40000] [--format text|json] [--max-files 500] [--out PATH]
```

| Exit | Meaning |
| --- | --- |
| `0` | Ran clean |
| `1` | Ran, with findings (resident over budget, or any unreceipted rule) |
| `2` | Could not run (bad path, unreadable files, `--out` inside the audited repo) |

A check that cannot run exits `2`, never `0`. **No fail-open** — a broken audit must never look
like a passing one.

## What a receipt is

Metadata answering three questions about a rule: what failure created it, who owns it, when to
retest it. Only two structured forms count:

```markdown
- ALWAYS run the suite before pushing. <!-- receipt: 2026-03-04 broken main after untested push | zhao | 2026-12-01 -->
- MUST tag the release before pushing the image. [receipt: 2026-02-02 untagged image rollback | zhao | 2026-11-01]
```

Prose that happens to mention a date is not a receipt. The whole value of the annotation is that
it is machine-checkable — once a retest date passes, the rule is tagged `RETEST_DUE`.

## The report

Four sections, in this order, and nothing else:

1. **Load cost** — per unit: resident or on-demand, bytes, estimated tokens. Then resident total
   against budget, as a number and a ratio.
2. **Precedence conflicts** — duplicate rule pairs above the similarity threshold, both
   locations, the score, and a `DIVERGED` tag where the copies have drifted apart.
3. **Receipts** — receipted vs unreceipted per unit; every unreceipted rule by `file:line`;
   `RETEST_DUE` on receipts whose retest date has passed.
4. **Dispositions** — exactly one of six per unit: `keep`, `one-home`, `load-later`,
   `turn-into-check`, `probation`, `retire`.

No adjectives anywhere. The report says "4.9x budget", never "bloated". Handing over a number
that arrives pre-judged is harder to argue with than handing over the number.

A footer prints every heuristic in effect — token estimate, similarity threshold, rule-detection
sets, precedence model, thresholds. Change one and findings change, so you should be able to see
all of them without reading the detector.

## Hard constraints

- **Read-only.** Never writes inside the audited repo. `--out` pointing inside it is refused with
  exit 2, before any work happens.
- **No LLM calls, no network.** Lexical and structural analysis only.
- **Deterministic.** Same repo state → byte-identical report, modulo the timestamp line. Files
  walked in sorted path order; findings sorted by `(file, line)`.
- **No silent truncation.** Files over 2 MB, binary files, unreadable files, and a hit
  `--max-files` cap are all named in the report. A cap you cannot see reads as full coverage.
- **Admits blindness.** A unit ≥ 2 KB with zero detected rules raises `SUSPECT_PARSE` rather than
  reporting a clean file. A false clean is worse than an honest gap.

## Dispositions are headings, not actions

Each disposition is a mechanical trigger, printed with the reason it fired. `retire` means "zero
receipts, zero inbound references, on-demand" — not "delete this." The tool never edits anything,
and the report says so in a fixed sentence above the section.

When several triggers fire, precedence is
`one-home` > `turn-into-check` > `retire` > `probation` > `load-later` > `keep`.

## Development

```bash
npm run verify      # typecheck + unit tests + fixture acceptance
npm run fixtures    # acceptance only
```

Acceptance is `npm run fixtures`, which audits three synthetic mini-repos against their
`EXPECTED.md` ground truth. Those `EXPECTED.md` files are a holdout: if you are implementing
against [SPEC.md](SPEC.md), do not read them. The grader reports unmet assertions with the
*actual* value only, so a failing run never leaks the expected one.

[IMPLEMENTATION_NOTES.md](IMPLEMENTATION_NOTES.md) documents every resolved `IMPL CHOICE`, the
deviations, and the known weaknesses — including the one that matters most: `probation` keys on
file mtime, which a fresh clone resets.

Zero runtime dependencies. Dev dependencies are TypeScript and vitest.

## Status

v0. The spec is [SPEC.md](SPEC.md); it is the contract, and where it disagrees with the code the
spec wins. [ROADMAP.md](ROADMAP.md) holds the post-v0 path and the ideas deliberately rejected.

## License

MIT — see [LICENSE](LICENSE).
