# broken-repo — ground truth
- include cycle a↔b: detected, reported ONCE, run completes (no hang)
- blob.bin (3 MB): SKIPPED line naming it; never silently dropped
- resident set: CLAUDE.md + a + b (via includes, cycle broken after first visit)
- rules: 1 (MUST validate input), unreceipted
- exit code: 1
- bonus assertion: running with --out pointing INSIDE this repo is refused with exit 2
