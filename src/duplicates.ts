import { KIND_RANK, SIMILARITY_THRESHOLD } from './heuristics.ts';
import { jaccard, round2 } from './normalize.ts';
import type { ContextUnit, DuplicatePair, Rule } from './types.ts';

/**
 * Pair duplicate rules (SPEC §1, §3.2).
 *
 * Guards from SPEC §5:
 *   - a rule never pairs with itself;
 *   - same-file pairs are allowed only across sections. Two near-identical
 *     lines under one heading are a drafting artifact, not a precedence
 *     conflict — there is no ambiguity about which context they load in.
 */
export function pairDuplicates(units: ContextUnit[]): DuplicatePair[] {
  const kindByPath = new Map(units.map((unit) => [unit.path, unit.kind]));
  const rules: Rule[] = units.flatMap((unit) => unit.rules);

  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < rules.length; i += 1) {
    for (let j = i + 1; j < rules.length; j += 1) {
      const a = rules[i] as Rule;
      const b = rules[j] as Rule;
      if (a.unitPath === b.unitPath && a.section === b.section) continue;

      const similarity = jaccard(a.tokens, b.tokens);
      if (similarity <= SIMILARITY_THRESHOLD) continue;

      const winner = precedenceWinner(a, b, kindByPath);
      pairs.push({
        a,
        b,
        similarity: round2(similarity),
        diverged: a.normalized !== b.normalized,
        winnerPath: winner.unitPath,
        winnerLine: winner.line,
      });
    }
  }

  pairs.sort((x, y) => {
    const byPath = cmp(x.a.unitPath, y.a.unitPath);
    if (byPath !== 0) return byPath;
    if (x.a.line !== y.a.line) return x.a.line - y.a.line;
    const byOther = cmp(x.b.unitPath, y.b.unitPath);
    if (byOther !== 0) return byOther;
    return x.b.line - y.b.line;
  });
  return pairs;
}

/**
 * The tool's precedence model (heuristics.PRECEDENCE_MODEL_DESCRIPTION).
 * The report states that this is the tool's model, not a guarantee about
 * runtime behavior — no auditor can know how a host actually resolves this.
 */
function precedenceWinner(
  a: Rule,
  b: Rule,
  kindByPath: Map<string, string>,
): Rule {
  const rankA = KIND_RANK[kindByPath.get(a.unitPath) ?? 'skill'] ?? 99;
  const rankB = KIND_RANK[kindByPath.get(b.unitPath) ?? 'skill'] ?? 99;
  if (rankA !== rankB) return rankA < rankB ? a : b;
  if (a.unitPath === b.unitPath) return a.ordinal > b.ordinal ? a : b;
  return cmp(a.unitPath, b.unitPath) <= 0 ? a : b;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
