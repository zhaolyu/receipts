import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { audit } from '../src/audit.ts';
import { run } from '../src/cli.ts';
import { renderText } from '../src/render.ts';

const NOW = new Date('2026-08-23T00:00:00Z');
const temps: string[] = [];

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function makeRepo(files: Record<string, string | Buffer>): string {
  const dir = mkdtempSync(join(tmpdir(), 'receipts-test-'));
  temps.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}

function auditOf(dir: string, budget = 40_000) {
  const result = audit({ repoPath: dir, budget, maxFiles: 500, now: NOW });
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result.value;
}

describe('exit codes (SPEC §2)', () => {
  it('exits 0 when every rule carries a receipt and resident fits budget', () => {
    const dir = makeRepo({
      'CLAUDE.md': '- MUST run tests. <!-- receipt: incident | zhao | 2027-01-01 -->\n',
    });
    expect(run(['audit', dir], NOW).exitCode).toBe(0);
  });

  it('exits 1 on unreceipted rules', () => {
    const dir = makeRepo({ 'CLAUDE.md': '- MUST run tests.\n' });
    expect(run(['audit', dir], NOW).exitCode).toBe(1);
  });

  it('exits 1 when resident tokens exceed budget', () => {
    const dir = makeRepo({
      'CLAUDE.md': '- MUST run tests. <!-- receipt: i | zhao | 2027-01-01 -->\n' + 'x'.repeat(5_000),
    });
    expect(run(['audit', dir, '--budget', '100'], NOW).exitCode).toBe(1);
  });

  it('exits 2 on a path that cannot be read — never fail-open', () => {
    const outcome = run(['audit', join(tmpdir(), 'receipts-does-not-exist-xyz')], NOW);
    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr).toContain('BAD_PATH');
  });

  it('exits 2 on a bad flag rather than auditing with a default', () => {
    expect(run(['audit', '.', '--format', 'yaml'], NOW).exitCode).toBe(2);
    expect(run(['audit', '.', '--budget', 'lots'], NOW).exitCode).toBe(2);
  });
});

describe('read-only guarantee (SPEC §4)', () => {
  it('refuses to write the report inside the audited repo', () => {
    const dir = makeRepo({ 'CLAUDE.md': '- MUST run tests.\n' });
    const outcome = run(['audit', dir, '--out', join(dir, 'report.txt')], NOW);
    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr).toContain('OUT_INSIDE_REPO');
  });

  it('writes to a path outside the audited repo', () => {
    const dir = makeRepo({ 'CLAUDE.md': '- MUST run tests.\n' });
    const out = join(mkdtempSync(join(tmpdir(), 'receipts-out-')), 'report.txt');
    temps.push(join(out, '..'));
    const outcome = run(['audit', dir, '--out', out], NOW);
    expect(outcome.exitCode).toBe(1);
    expect(readFileSync(out, 'utf8')).toContain('## 1. Load cost');
  });
});

describe('silent failures (SPEC §5)', () => {
  it('skips an oversize file by name instead of dropping it', () => {
    const dir = makeRepo({
      'CLAUDE.md': '- MUST run tests.\n',
      'blob.bin': Buffer.alloc(3_000_000, 1),
    });
    const result = auditOf(dir);
    expect(result.skipped.map((skip) => skip.path)).toContain('blob.bin');
    expect(result.skipped[0]?.reason).toContain('exceeds');
  });

  it('skips a binary file by name', () => {
    const dir = makeRepo({
      'CLAUDE.md': '- MUST run tests.\n',
      'thing.dat': Buffer.from([0x41, 0x00, 0x42]),
    });
    expect(auditOf(dir).skipped.map((skip) => skip.path)).toContain('thing.dat');
  });

  it('detects an include cycle once and terminates', () => {
    const dir = makeRepo({
      'CLAUDE.md': '@include skills/a/SKILL.md\n',
      'skills/a/SKILL.md': '@include ../b/SKILL.md\n- MUST validate input.\n',
      'skills/b/SKILL.md': '@include ../a/SKILL.md\n',
    });
    const result = auditOf(dir);
    expect(result.cycles).toHaveLength(1);
  });

  it('marks @-included files resident', () => {
    const dir = makeRepo({
      'CLAUDE.md': '@include skills/a/SKILL.md\n',
      'skills/a/SKILL.md': '- MUST validate input.\n',
      'skills/z/SKILL.md': '- MUST do something else.\n',
    });
    const result = auditOf(dir);
    const byPath = new Map(result.units.map((unit) => [unit.path, unit.residency]));
    expect(byPath.get('skills/a/SKILL.md')).toBe('resident');
    expect(byPath.get('skills/z/SKILL.md')).toBe('on-demand');
  });

  it('never pairs a rule with itself, or with a same-section sibling', () => {
    const dir = makeRepo({
      'CLAUDE.md':
        '# Rules\n- ALWAYS cite the source document when quoting.\n' +
        '- ALWAYS cite the source document when you quote from it.\n',
    });
    expect(auditOf(dir).pairs).toHaveLength(0);
  });

  it('pairs same-file rules that sit in different sections', () => {
    const dir = makeRepo({
      'CLAUDE.md':
        '# A\n- ALWAYS cite the source document when quoting.\n' +
        '# B\n- ALWAYS cite the source document when quoting.\n',
    });
    expect(auditOf(dir).pairs).toHaveLength(1);
  });

  it('reports the max-files cap instead of truncating silently', () => {
    const files: Record<string, string> = { 'CLAUDE.md': '- MUST run tests.\n' };
    for (let i = 0; i < 20; i += 1) files[`skills/s${i}/SKILL.md`] = '- MUST do a thing.\n';
    const dir = makeRepo(files);
    const result = audit({ repoPath: dir, budget: 40_000, maxFiles: 5, now: NOW });
    if (!result.ok) throw new Error('expected audit to run');
    expect(result.value.notes.join(' ')).toContain('MAX_FILES_REACHED');
  });
});

describe('reproducibility (definition of done #4)', () => {
  it('produces byte-identical reports apart from the timestamp line', () => {
    const dir = makeRepo({
      'CLAUDE.md': '# Rules\n- MUST run tests.\n- NEVER push to main.\n',
      'skills/deploy/SKILL.md': '---\nname: deploy\n---\n- MUST tag the release.\n',
    });
    const strip = (text: string) =>
      text
        .split('\n')
        .filter((line) => !line.startsWith('generated '))
        .join('\n');
    const first = strip(renderText(auditOf(dir), 'A'));
    const second = strip(renderText(auditOf(dir), 'B'));
    expect(first).toBe(second);
  });
});

describe('dispositions (SPEC §3.4)', () => {
  it('assigns one-home ahead of every other trigger', () => {
    const dir = makeRepo({
      'CLAUDE.md': '- ALWAYS cite the source document when quoting.\n',
      'skills/writing/SKILL.md': '- ALWAYS cite sources when quoting.\n',
    });
    const result = auditOf(dir);
    const byPath = new Map(result.dispositions.map((d) => [d.unitPath, d.disposition]));
    expect(byPath.get('CLAUDE.md')).toBe('one-home');
    expect(byPath.get('skills/writing/SKILL.md')).toBe('one-home');
  });

  it('assigns turn-into-check at three checkable rules', () => {
    const dir = makeRepo({
      'CLAUDE.md': '# Root\nThe review skill is used at review time.\n',
      'skills/review/SKILL.md':
        '- Check that the summary is under 500 words.\n' +
        '- Check that no emojis appear.\n' +
        '- Check that all quotes carry citations.\n',
    });
    const result = auditOf(dir);
    const byPath = new Map(result.dispositions.map((d) => [d.unitPath, d.disposition]));
    expect(byPath.get('skills/review/SKILL.md')).toBe('turn-into-check');
  });

  it('assigns retire to an unreferenced, unreceipted, on-demand unit', () => {
    const dir = makeRepo({
      'CLAUDE.md': '# Root\n- MUST run tests. <!-- receipt: i | zhao | 2027-01-01 -->\n',
      'skills/orphan/SKILL.md': '- MUST do a forgotten thing.\n',
    });
    const result = auditOf(dir);
    const byPath = new Map(result.dispositions.map((d) => [d.unitPath, d.disposition]));
    expect(byPath.get('skills/orphan/SKILL.md')).toBe('retire');
  });

  it('gives every unit exactly one disposition', () => {
    const dir = makeRepo({
      'CLAUDE.md': '- MUST run tests.\n',
      'skills/a/SKILL.md': '- MUST do a.\n',
    });
    const result = auditOf(dir);
    expect(result.dispositions).toHaveLength(result.units.length);
    expect(new Set(result.dispositions.map((d) => d.unitPath)).size).toBe(result.units.length);
  });
});

describe('json format', () => {
  it('emits parseable json carrying the heuristics in effect', () => {
    const dir = makeRepo({ 'CLAUDE.md': '- MUST run tests.\n' });
    const outcome = run(['audit', dir, '--format', 'json'], NOW);
    const parsed = JSON.parse(outcome.stdout);
    expect(parsed.heuristics.similarityThreshold).toBe(0.7);
    expect(parsed.totals.ruleCount).toBe(1);
  });
});
