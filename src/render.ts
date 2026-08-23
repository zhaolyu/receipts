import {
  CHECKABLE_PATTERNS,
  IMPERATIVE_VERBS,
  MODAL_TOKENS,
  MAX_FILE_BYTES,
  PRECEDENCE_MODEL_DESCRIPTION,
  SIMILARITY_THRESHOLD,
  STALE_DAYS,
  SUSPECT_PARSE_MIN_BYTES,
  TOKEN_BYTES_PER_TOKEN,
} from './heuristics.ts';
import type { AuditResult } from './types.ts';

/**
 * SPEC §3 — four sections, in this order, nothing else, then the footer that
 * CLAUDE.md's definition of done requires.
 *
 * No adjectives anywhere in this file. "4.9x budget", never "bloated": the
 * report's job is to hand over numbers, and a number that arrives pre-judged
 * is harder to argue with than one that doesn't.
 */
export function renderText(result: AuditResult, timestamp: string): string {
  const lines: string[] = [];
  const { totals } = result;

  lines.push(`receipts audit — ${result.repoPath}`);
  lines.push(`generated ${timestamp}`);
  lines.push('');

  for (const note of result.notes) lines.push(note);
  if (result.notes.length > 0) lines.push('');

  // ---- 1. Load cost -------------------------------------------------------
  lines.push('## 1. Load cost');
  lines.push('');
  if (result.units.length === 0) {
    lines.push('  (no context units found)');
  } else {
    lines.push(pad('FILE', 52) + pad('RESIDENCY', 12) + pad('BYTES', 10) + 'TOKENS');
    for (const unit of result.units) {
      lines.push(
        pad(unit.path, 52) +
          pad(unit.residency, 12) +
          pad(String(unit.bytes), 10) +
          String(unit.tokens),
      );
    }
  }
  lines.push('');
  lines.push(`  resident tokens: ${totals.residentTokens}`);
  lines.push(`  on-demand tokens: ${totals.onDemandTokens}`);
  lines.push(`  budget: ${totals.budget}`);
  lines.push(`  resident vs budget: ${totals.budgetRatio}x`);

  for (const skip of result.skipped) {
    lines.push(`  SKIPPED ${skip.path} — ${skip.reason}`);
  }
  for (const cycle of result.cycles) {
    lines.push(`  INCLUDE_CYCLE ${cycle.join(' -> ')}`);
  }
  for (const unit of result.units) {
    for (const warning of unit.warnings) lines.push(`  ${warning} (${unit.path})`);
  }
  lines.push('');

  // ---- 2. Precedence conflicts -------------------------------------------
  lines.push('## 2. Precedence conflicts');
  lines.push('');
  lines.push(`  similarity threshold: ${SIMILARITY_THRESHOLD}`);
  lines.push(`  precedence model: ${PRECEDENCE_MODEL_DESCRIPTION}`);
  lines.push(
    '  This is the tool\'s precedence model. It is not a guarantee about how any',
  );
  lines.push('  runtime actually resolves these rules.');
  lines.push('');
  if (result.pairs.length === 0) {
    lines.push('  (no duplicate rule pairs above threshold)');
  } else {
    for (const pair of result.pairs) {
      const tag = pair.diverged ? ' DIVERGED' : '';
      lines.push(
        `  ${pair.a.unitPath}:${pair.a.line}  <->  ${pair.b.unitPath}:${pair.b.line}` +
          `  similarity ${pair.similarity}${tag}`,
      );
      lines.push(`      a: ${truncate(pair.a.text, 80)}`);
      lines.push(`      b: ${truncate(pair.b.text, 80)}`);
      lines.push(`      wins: ${pair.winnerPath}:${pair.winnerLine}`);
    }
  }
  lines.push('');

  // ---- 3. Receipts --------------------------------------------------------
  lines.push('## 3. Receipts');
  lines.push('');
  lines.push(
    `  rules with receipts: ${totals.receiptedRules} / ${totals.ruleCount}` +
      `   without: ${totals.unreceiptedRules}`,
  );
  lines.push('');
  for (const unit of result.units) {
    const receipted = unit.rules.filter((rule) => rule.receipt !== null).length;
    lines.push(`  ${unit.path}: ${receipted}/${unit.rules.length} receipted`);
    for (const rule of unit.rules) {
      if (rule.receipt === null) {
        lines.push(`      UNRECEIPTED ${unit.path}:${rule.line} ${truncate(rule.text, 80)}`);
      } else if (rule.receipt.retestDue) {
        lines.push(
          `      RETEST_DUE ${unit.path}:${rule.line} retest ${rule.receipt.retest}` +
            ` owner ${rule.receipt.owner}`,
        );
      }
    }
  }
  lines.push('');

  // ---- 4. Dispositions ----------------------------------------------------
  lines.push('## 4. Dispositions');
  lines.push('');
  lines.push('  A disposition is a recommendation heading. This tool never edits anything.');
  lines.push('');
  for (const disposition of result.dispositions) {
    lines.push(`  ${pad(disposition.disposition, 18)}${disposition.unitPath}`);
    lines.push(`      ${disposition.trigger}`);
  }
  lines.push('');

  // ---- footer -------------------------------------------------------------
  lines.push('---');
  lines.push('heuristics in effect (change these and findings change):');
  lines.push(`  token estimate: bytes / ${TOKEN_BYTES_PER_TOKEN}`);
  lines.push(`  duplicate threshold: Jaccard > ${SIMILARITY_THRESHOLD} on normalized tokens`);
  lines.push('  normalization: lowercase, strip punctuation, drop stopwords, strip plural -s');
  lines.push(`  rule detection (a): uppercase modal — ${MODAL_TOKENS.join(', ')}`);
  lines.push(
    `  rule detection (b): list item opening with an imperative verb — ` +
      `${IMPERATIVE_VERBS.length} verbs, see src/heuristics.ts`,
  );
  lines.push('  free prose without a modal is never counted as a rule');
  lines.push(
    `  checkable patterns: ${CHECKABLE_PATTERNS.map((pattern) => pattern.name).join(', ')}`,
  );
  lines.push(`  SUSPECT_PARSE when a unit is >= ${SUSPECT_PARSE_MIN_BYTES} bytes with 0 rules`);
  lines.push(`  probation staleness cutoff: ${STALE_DAYS} days by file mtime`);
  lines.push(`  files over ${MAX_FILE_BYTES} bytes are skipped and named`);
  lines.push(`  exit: 0 clean, 1 findings, 2 could not run. findings=${result.findings}`);

  return lines.join('\n') + '\n';
}

/** Stable JSON, same data, for downstream tooling. */
export function renderJson(result: AuditResult, timestamp: string): string {
  return (
    JSON.stringify(
      {
        generated: timestamp,
        repoPath: result.repoPath,
        totals: result.totals,
        notes: result.notes,
        skipped: result.skipped,
        cycles: result.cycles,
        units: result.units.map((unit) => ({
          path: unit.path,
          kind: unit.kind,
          residency: unit.residency,
          bytes: unit.bytes,
          tokens: unit.tokens,
          inboundRefs: unit.inboundRefs,
          warnings: unit.warnings,
          rules: unit.rules.map((rule) => ({
            line: rule.line,
            section: rule.section,
            text: rule.text,
            detectedBy: rule.detectedBy,
            checkable: rule.checkable,
            receipt: rule.receipt,
          })),
        })),
        pairs: result.pairs.map((pair) => ({
          a: { path: pair.a.unitPath, line: pair.a.line, text: pair.a.text },
          b: { path: pair.b.unitPath, line: pair.b.line, text: pair.b.text },
          similarity: pair.similarity,
          diverged: pair.diverged,
          winner: { path: pair.winnerPath, line: pair.winnerLine },
        })),
        dispositions: result.dispositions,
        heuristics: {
          tokenBytesPerToken: TOKEN_BYTES_PER_TOKEN,
          similarityThreshold: SIMILARITY_THRESHOLD,
          precedenceModel: PRECEDENCE_MODEL_DESCRIPTION,
          modalTokens: MODAL_TOKENS,
          imperativeVerbCount: IMPERATIVE_VERBS.length,
          checkablePatterns: CHECKABLE_PATTERNS.map((pattern) => pattern.name),
          suspectParseMinBytes: SUSPECT_PARSE_MIN_BYTES,
          staleDays: STALE_DAYS,
          maxFileBytes: MAX_FILE_BYTES,
        },
        findings: result.findings,
      },
      null,
      2,
    ) + '\n'
  );
}

function pad(text: string, width: number): string {
  return text.length >= width ? text + '  ' : text + ' '.repeat(width - text.length);
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : flat.slice(0, max);
}
