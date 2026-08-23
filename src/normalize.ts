import { STOPWORDS } from './heuristics.ts';

/**
 * Normalization for duplicate detection (SPEC §1).
 *
 * lowercase → strip markdown/punctuation → drop stopwords → depluralize.
 *
 * The depluralize step is a single trailing-`s` strip on tokens longer than
 * three characters. It is crude on purpose: it collapses `source`/`sources`
 * and `quote`/`quotes`, which is the entire class of near-duplicate this
 * report exists to surface, without pulling in a stemmer dependency whose
 * behavior would then also need documenting.
 */
export function normalizeTokens(text: string): string[] {
  const stripped = text
    .toLowerCase()
    // Inline code, emphasis, and links carry no comparison signal.
    .replace(/`[^`]*`/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~]/g, ' ')
    // Keep digits: numeric thresholds are meaningful tokens.
    .replace(/[^a-z0-9\s-]/g, ' ');

  const out: string[] = [];
  for (const raw of stripped.split(/\s+/)) {
    const token = raw.replace(/^-+|-+$/g, '');
    if (!token) continue;
    if (STOPWORDS.has(token)) continue;
    out.push(depluralize(token));
  }
  return out;
}

function depluralize(token: string): string {
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) {
    return token.slice(0, -1);
  }
  return token;
}

/**
 * Jaccard similarity over token *sets*. Returns 0 when either side is empty —
 * two empty rules are not a duplicate pair, they are a detection bug.
 */
export function jaccard(a: readonly string[], b: readonly string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Two decimal places, so report output is stable across runs. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Four decimal places: a resident/budget ratio of 0.002 must not render as 0. */
export function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
