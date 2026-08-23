import { describe, expect, it } from 'vitest';
import { jaccard, normalizeTokens } from '../src/normalize.ts';
import { detectRules, findModal, parseReceipt } from '../src/rules.ts';
import { parseIncludes } from '../src/units.ts';
import type { ContextUnit } from '../src/types.ts';
import type { WalkedFile } from '../src/walk.ts';

const NOW = new Date('2026-08-23T00:00:00Z');

function unitOf(text: string, path = 'CLAUDE.md'): ContextUnit {
  const unit: ContextUnit = {
    path,
    kind: 'root',
    residency: 'resident',
    bytes: Buffer.byteLength(text),
    tokens: Math.ceil(Buffer.byteLength(text) / 4),
    declaredName: null,
    rules: [],
    warnings: [],
    inboundRefs: 0,
    mtimeMs: NOW.getTime(),
  };
  const file: WalkedFile = {
    path,
    absPath: '/tmp/' + path,
    bytes: unit.bytes,
    text,
    mtimeMs: NOW.getTime(),
  };
  detectRules(unit, file, NOW);
  return unit;
}

describe('rule detection', () => {
  it('detects uppercase modals', () => {
    const unit = unitOf('- Output MUST be under 500 words.\n- NEVER commit to main.\n');
    expect(unit.rules.map((rule) => rule.detectedBy)).toEqual(['modal', 'modal']);
  });

  it('detects bulleted imperatives', () => {
    const unit = unitOf('- Check that no emojis appear.\n');
    expect(unit.rules).toHaveLength(1);
    expect(unit.rules[0]?.detectedBy).toBe('bulleted-imperative');
  });

  it('does not count free prose as a rule, even when it opens with a verb', () => {
    // Precision over recall (SPEC §1): miscounting prose as a rule is the
    // failure that inflates every unreceipted count downstream.
    const unit = unitOf('## Notes\nUse deploy for production pushes.\n');
    expect(unit.rules).toHaveLength(0);
  });

  it('counts lowercase "must" as prose, not a modal', () => {
    expect(findModal('the build must be green')).toBeNull();
    expect(findModal('the build MUST be green')).toBe('MUST');
  });

  it('ignores fenced code blocks', () => {
    const unit = unitOf('```\n- MUST do the thing\n```\n- MUST do the real thing\n');
    expect(unit.rules).toHaveLength(1);
    expect(unit.rules[0]?.text).toBe('MUST do the real thing');
  });

  it('ignores frontmatter', () => {
    const unit = unitOf('---\nname: x\ndescription: MUST not count\n---\n- MUST count.\n');
    expect(unit.rules).toHaveLength(1);
  });

  it('tracks the enclosing section', () => {
    const unit = unitOf('# A\n- MUST one.\n## B\n- MUST two.\n');
    expect(unit.rules.map((rule) => rule.section)).toEqual(['A', 'B']);
  });

  it('raises SUSPECT_PARSE on a large file with zero rules', () => {
    const unit = unitOf('lorem ipsum '.repeat(300));
    expect(unit.warnings.join(' ')).toContain('SUSPECT_PARSE');
  });

  it('does not raise SUSPECT_PARSE on a small file with zero rules', () => {
    expect(unitOf('# Root\n').warnings).toEqual([]);
  });
});

describe('receipts', () => {
  it('parses the HTML-comment form, including hyphenated dates', () => {
    const { receipt, stripped } = parseReceipt(
      'ALWAYS run tests. <!-- receipt: 2026-03-04 broken main | zhao | 2026-12-01 -->',
      NOW,
    );
    expect(receipt?.owner).toBe('zhao');
    expect(receipt?.retest).toBe('2026-12-01');
    expect(receipt?.retestDue).toBe(false);
    expect(stripped).toBe('ALWAYS run tests.');
  });

  it('parses the trailing-bracket form', () => {
    const { receipt } = parseReceipt('MUST tag releases. [receipt: rollback | zhao | 2025-01-01]', NOW);
    expect(receipt?.owner).toBe('zhao');
    expect(receipt?.retestDue).toBe(true);
  });

  it('does not treat prose mentioning a date as a receipt', () => {
    const { receipt } = parseReceipt('MUST do this, added 2026-03-04 after an incident.', NOW);
    expect(receipt).toBeNull();
  });
});

describe('normalization', () => {
  it('collapses singular and plural so reworded rules still pair', () => {
    const a = normalizeTokens('ALWAYS cite the source document when quoting.');
    const b = normalizeTokens('ALWAYS cite sources when quoting.');
    expect(jaccard(a, b)).toBeGreaterThan(0.7);
  });

  it('keeps genuinely different rules below threshold', () => {
    const a = normalizeTokens('Check that the summary is under 500 words.');
    const b = normalizeTokens('Output MUST be under 500 words.');
    expect(jaccard(a, b)).toBeLessThanOrEqual(0.7);
  });

  it('scores an empty side as zero rather than one', () => {
    expect(jaccard([], [])).toBe(0);
    expect(jaccard(['a'], [])).toBe(0);
  });
});

describe('include parsing', () => {
  it('resolves relative to the including file', () => {
    expect(parseIncludes('skills/a/SKILL.md', '@include ../b/SKILL.md')).toEqual([
      'skills/b/SKILL.md',
    ]);
  });

  it('accepts the bare @path form', () => {
    expect(parseIncludes('CLAUDE.md', '@docs/rules.md')).toEqual(['docs/rules.md']);
  });

  it('ignores includes inside code fences', () => {
    expect(parseIncludes('CLAUDE.md', '```\n@include skills/a/SKILL.md\n```')).toEqual([]);
  });

  it('refuses to escape the repo root', () => {
    expect(parseIncludes('CLAUDE.md', '@include ../../secrets.md')).toEqual([]);
  });
});
