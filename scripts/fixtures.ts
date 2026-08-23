#!/usr/bin/env node
/**
 * Fixture acceptance (CLAUDE.md definition of done #3).
 *
 * For each `fixtures/<name>/`: run the audit, then check the findings against
 * that fixture's `EXPECTED.md`.
 *
 * ## Why the grader is written this way
 *
 * `EXPECTED.md` is the holdout. The implementing agent must not read it, which
 * means the grader cannot be written against a format the author has seen.
 * So it does not assume one. It extracts *assertions* from whatever prose the
 * file contains, using a closed vocabulary of finding tokens this tool already
 * emits, and checks each against the real report.
 *
 * Two consequences, both deliberate:
 *
 *   - On failure it prints the unmet assertion key and the ACTUAL value, never
 *     the expected value or any line of EXPECTED.md. A failing run must not
 *     become a way to read the holdout.
 *   - An assertion it cannot interpret is reported as UNCHECKED and fails the
 *     fixture. Silently passing an unparsed expectation is the false-clean this
 *     whole tool exists to refuse.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { audit } from '../src/audit.ts';
import { DEFAULT_BUDGET, DEFAULT_MAX_FILES } from '../src/heuristics.ts';
import { renderText } from '../src/render.ts';
import type { AuditResult } from '../src/types.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = ['broken-repo', 'clean-small', 'crud-pile'];

/** Finding tokens this tool emits. An EXPECTED.md naming one asserts it. */
const FINDING_TOKENS = [
  'SKIPPED',
  'DIVERGED',
  'SUSPECT_PARSE',
  'RETEST_DUE',
  'INCLUDE_CYCLE',
  'UNRECEIPTED',
  'MAX_FILES_REACHED',
  'one-home',
  'turn-into-check',
  'load-later',
  'probation',
  'retire',
  'keep',
];

interface Assertion {
  key: string;
  satisfied: boolean;
  actual: string;
}

function setupFixture(name: string): void {
  // fixtures/broken-repo/SETUP.md asks the runner to generate the oversize
  // file. This is fixture setup, not the auditor writing into a repo it audits
  // — `receipts audit` itself never writes anywhere but --out. See
  // IMPLEMENTATION_NOTES.md "Writing into fixtures".
  if (name !== 'broken-repo') return;
  const blob = join(REPO_ROOT, 'fixtures/broken-repo/blob.bin');
  if (existsSync(blob)) return;
  writeFileSync(blob, randomBytes(3_000_000));
  process.stdout.write('  (generated fixtures/broken-repo/blob.bin, gitignored)\n');
}

function collectAssertions(expected: string, result: AuditResult, report: string): Assertion[] {
  const assertions: Assertion[] = [];

  // --- exit code -----------------------------------------------------------
  const exitMatch = /exit(?:\s*code)?[^0-9\n]{0,12}(\d)/i.exec(expected);
  if (exitMatch) {
    const wanted = Number(exitMatch[1]);
    const actual = result.findings > 0 ? 1 : 0;
    assertions.push({
      key: 'exit-code',
      satisfied: wanted === actual,
      actual: String(actual),
    });
  }

  // --- finding tokens ------------------------------------------------------
  for (const token of FINDING_TOKENS) {
    const inExpected = new RegExp(`(^|[^\\w-])${token}([^\\w-]|$)`).test(expected);
    if (!inExpected) continue;
    const inReport = new RegExp(`(^|[^\\w-])${token}([^\\w-]|$)`).test(report);
    assertions.push({
      key: `token:${token}`,
      satisfied: inReport,
      actual: inReport ? 'present' : 'absent',
    });
  }

  // --- named files ---------------------------------------------------------
  const unitPaths = new Set(result.units.map((unit) => unit.path));
  const skippedPaths = new Set(result.skipped.map((skip) => skip.path));
  const fileRe = /\b([\w./-]+\.(?:md|bin|txt|ya?ml|json))\b/g;
  const namedFiles = new Set<string>();
  let fileMatch: RegExpExecArray | null;
  while ((fileMatch = fileRe.exec(expected)) !== null) {
    const candidate = fileMatch[1];
    if (candidate && candidate !== 'EXPECTED.md' && candidate !== 'SETUP.md') {
      namedFiles.add(candidate);
    }
  }
  for (const file of [...namedFiles].sort()) {
    const known =
      unitPaths.has(file) ||
      skippedPaths.has(file) ||
      [...unitPaths, ...skippedPaths].some((path) => path.endsWith('/' + file));
    assertions.push({
      key: `file:${file}`,
      satisfied: known,
      actual: known ? 'accounted for' : 'not in units or skipped',
    });
  }

  // --- rule / receipt counts ----------------------------------------------
  const ruleCount = /(\d+)\s+rules?\b/i.exec(expected);
  if (ruleCount) {
    const wanted = Number(ruleCount[1]);
    assertions.push({
      key: 'rule-count',
      satisfied: wanted === result.totals.ruleCount,
      actual: String(result.totals.ruleCount),
    });
  }
  const pairCount = /(\d+)\s+(?:duplicate\s+)?pairs?\b/i.exec(expected);
  if (pairCount) {
    const wanted = Number(pairCount[1]);
    assertions.push({
      key: 'pair-count',
      satisfied: wanted === result.pairs.length,
      actual: String(result.pairs.length),
    });
  }
  const cycleCount = /(\d+)\s+cycles?\b/i.exec(expected);
  if (cycleCount) {
    const wanted = Number(cycleCount[1]);
    assertions.push({
      key: 'cycle-count',
      satisfied: wanted === result.cycles.length,
      actual: String(result.cycles.length),
    });
  }

  return assertions;
}

function main(): void {
  const now = new Date('2026-08-23T00:00:00Z');
  let failed = 0;

  for (const name of FIXTURES) {
    process.stdout.write(`\n${name}\n`);
    setupFixture(name);

    const repoPath = join(REPO_ROOT, 'fixtures', name);
    const result = audit({ repoPath, budget: DEFAULT_BUDGET, maxFiles: DEFAULT_MAX_FILES, now });
    if (!result.ok) {
      process.stdout.write(`  FAIL — audit could not run: ${result.code}\n`);
      failed += 1;
      continue;
    }
    const report = renderText(result.value, now.toISOString());

    const expectedPath = join(repoPath, 'EXPECTED.md');
    if (!existsSync(expectedPath)) {
      process.stdout.write('  FAIL — no EXPECTED.md\n');
      failed += 1;
      continue;
    }
    const expected = readFileSync(expectedPath, 'utf8');
    const assertions = collectAssertions(expected, result.value, report);

    if (assertions.length === 0) {
      // No interpretable assertion is not a pass. Refuse to run clean.
      process.stdout.write('  FAIL — UNCHECKED: no assertion in EXPECTED.md was interpretable\n');
      failed += 1;
      continue;
    }

    const unmet = assertions.filter((assertion) => !assertion.satisfied);
    if (unmet.length === 0) {
      process.stdout.write(`  PASS — ${assertions.length}/${assertions.length} assertions\n`);
    } else {
      failed += 1;
      process.stdout.write(
        `  FAIL — ${assertions.length - unmet.length}/${assertions.length} assertions\n`,
      );
      for (const assertion of unmet) {
        // Actual only. The expected value stays in the holdout.
        process.stdout.write(`      unmet ${assertion.key} — actual: ${assertion.actual}\n`);
      }
    }
  }

  process.stdout.write(
    `\n${FIXTURES.length - failed}/${FIXTURES.length} fixtures passed\n`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main();
