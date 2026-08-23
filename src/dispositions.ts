import { STALE_DAYS } from './heuristics.ts';
import type { ContextUnit, Disposition, DuplicatePair, UnitDisposition } from './types.ts';

/**
 * SPEC §3.4 — exactly one disposition per context unit, assigned mechanically.
 *
 * Precedence when several triggers fire:
 *   one-home > turn-into-check > retire > probation > load-later > keep
 *
 * `keep` is both a trigger (resident, ≥50% receipted, no diverged duplicates)
 * and the fallback. A unit that fires nothing gets `keep` — the tool's least
 * opinionated answer, which is the right default for a report that never edits.
 */
export function assignDispositions(
  units: ContextUnit[],
  pairs: DuplicatePair[],
  rootTexts: string[],
  now: Date,
): UnitDisposition[] {
  const divergedUnits = new Set<string>();
  for (const pair of pairs) {
    if (!pair.diverged) continue;
    divergedUnits.add(pair.a.unitPath);
    divergedUnits.add(pair.b.unitPath);
  }

  return units.map((unit) => {
    const { disposition, trigger } = dispositionFor(unit, divergedUnits, rootTexts, now);
    return { unitPath: unit.path, disposition, trigger };
  });
}

function dispositionFor(
  unit: ContextUnit,
  divergedUnits: Set<string>,
  rootTexts: string[],
  now: Date,
): { disposition: Disposition; trigger: string } {
  const receipted = unit.rules.filter((rule) => rule.receipt !== null).length;
  const ageDays = (now.getTime() - unit.mtimeMs) / 86_400_000;
  const checkable = unit.rules.filter((rule) => rule.checkable.length > 0).length;

  if (divergedUnits.has(unit.path)) {
    return {
      disposition: 'one-home',
      trigger: 'participates in diverged duplicate pairs (its rules exist elsewhere)',
    };
  }
  if (checkable >= 3) {
    return {
      disposition: 'turn-into-check',
      trigger: `${checkable} rules match mechanically-checkable patterns`,
    };
  }
  if (receipted === 0 && unit.inboundRefs === 0 && unit.residency === 'on-demand') {
    return {
      disposition: 'retire',
      trigger: 'zero receipts, zero inbound references, on-demand',
    };
  }
  if (receipted === 0 && ageDays > STALE_DAYS) {
    return {
      disposition: 'probation',
      trigger: `zero receipts and mtime ${Math.floor(ageDays)} days old (> ${STALE_DAYS})`,
    };
  }
  if (unit.residency === 'resident' && unit.kind !== 'root' && !referencedByRoot(unit, rootTexts)) {
    return {
      disposition: 'load-later',
      trigger: 'resident but no root-file reference names it',
    };
  }

  const ratio = unit.rules.length === 0 ? 0 : receipted / unit.rules.length;
  if (unit.residency === 'resident' && ratio >= 0.5) {
    return {
      disposition: 'keep',
      trigger: `resident, ${receipted}/${unit.rules.length} rules receipted, no diverged duplicates`,
    };
  }
  return { disposition: 'keep', trigger: 'no other trigger fired' };
}

function referencedByRoot(unit: ContextUnit, rootTexts: string[]): boolean {
  const needles = [unit.path];
  if (unit.declaredName) needles.push(unit.declaredName);
  const dir = unit.path.split('/').slice(-2, -1)[0];
  if (unit.path.endsWith('/SKILL.md') && dir) needles.push(dir);

  return rootTexts.some((text) =>
    needles.some((needle) => {
      const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(^|[^\\w/-])${escaped}([^\\w-]|$)`).test(text);
    }),
  );
}
