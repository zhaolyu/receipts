import { resolve } from 'node:path';
import { pairDuplicates } from './duplicates.ts';
import { assignDispositions } from './dispositions.ts';
import { detectRules } from './rules.ts';
import { buildUnits, countInboundRefs } from './units.ts';
import { round4 } from './normalize.ts';
import { walk } from './walk.ts';
import type { AuditResult, AuditTotals, Result } from './types.ts';

export interface AuditOptions {
  repoPath: string;
  budget: number;
  maxFiles: number;
  /** Injected so tests and fixture runs are not clock-dependent. */
  now: Date;
  /** Absolute path the report will be written to, if any. */
  outPath?: string | undefined;
}

/**
 * walk → classify → detect-rules → pair-duplicates → receipts → dispositions.
 * Pure with respect to everything but the filesystem read; renders nothing.
 */
export function audit(options: AuditOptions): Result<AuditResult> {
  const repoPath = resolve(options.repoPath);

  // SPEC §4 / §5: the tool never writes inside the audited repo. Refusing here
  // — before any work — means a misaimed --out can never half-run.
  if (options.outPath) {
    const out = resolve(options.outPath);
    if (out === repoPath || out.startsWith(repoPath + '/')) {
      return {
        ok: false,
        code: 'OUT_INSIDE_REPO',
        message: `refusing to write the report inside the audited repo: ${out}`,
      };
    }
  }

  const walked = walk(repoPath, options.maxFiles);
  if (!walked.ok) return walked;
  const { files, skipped, notes } = walked.value;

  const { units, cycles } = buildUnits(files);

  const fileByPath = new Map(files.map((file) => [file.path, file]));
  for (const unit of units) {
    const file = fileByPath.get(unit.path);
    if (file) detectRules(unit, file, options.now);
  }

  countInboundRefs(units, files);

  const pairs = pairDuplicates(units);
  const rootTexts = units
    .filter((unit) => unit.kind === 'root')
    .map((unit) => fileByPath.get(unit.path)?.text ?? '');
  const dispositions = assignDispositions(units, pairs, rootTexts, options.now);

  const allRules = units.flatMap((unit) => unit.rules);
  const residentTokens = units
    .filter((unit) => unit.residency === 'resident')
    .reduce((sum, unit) => sum + unit.tokens, 0);
  const onDemandTokens = units
    .filter((unit) => unit.residency === 'on-demand')
    .reduce((sum, unit) => sum + unit.tokens, 0);
  const unreceipted = allRules.filter((rule) => rule.receipt === null).length;

  const totals: AuditTotals = {
    residentTokens,
    onDemandTokens,
    budget: options.budget,
    budgetRatio: options.budget === 0 ? 0 : round4(residentTokens / options.budget),
    overBudget: residentTokens > options.budget,
    ruleCount: allRules.length,
    receiptedRules: allRules.length - unreceipted,
    unreceiptedRules: unreceipted,
    retestDueRules: allRules.filter((rule) => rule.receipt?.retestDue === true).length,
  };

  // SPEC §2 — exit 1 when there are findings. Findings are exactly the two
  // conditions the spec names; skips and cycles are reported but do not by
  // themselves make a run "found something".
  const findings =
    (totals.overBudget ? 1 : 0) + (totals.unreceiptedRules > 0 ? 1 : 0);

  return {
    ok: true,
    value: {
      repoPath,
      units,
      skipped,
      cycles,
      pairs,
      dispositions,
      totals,
      notes,
      findings,
    },
  };
}
