import {
  CHECKABLE_PATTERNS,
  IMPERATIVE_VERBS,
  MODAL_TOKENS,
  SUSPECT_PARSE_MIN_BYTES,
} from './heuristics.ts';
import { normalizeTokens } from './normalize.ts';
import type { ContextUnit, Receipt, Rule } from './types.ts';
import type { WalkedFile } from './walk.ts';

const IMPERATIVE_SET = new Set<string>(IMPERATIVE_VERBS);

/** Whole-word, uppercase modal. Lowercase "must" is prose; requiring caps is
 *  the precision half of "precision over recall". */
function findModal(line: string): string | null {
  for (const modal of MODAL_TOKENS) {
    const escaped = modal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|[^A-Za-z])${escaped}([^A-Za-z]|$)`).test(line)) return modal;
  }
  return null;
}

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;

/**
 * Receipt annotations (SPEC §1): only these two structured forms count.
 * Prose that happens to mention a date is not a receipt.
 */
const RECEIPT_HTML = /<!--\s*receipt:\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*(.*?)\s*-->/;
const RECEIPT_TRAILING = /\[receipt:\s*([^|\]]*?)\s*\|\s*([^|\]]*?)\s*\|\s*([^\]]*?)\s*\]/;

function parseReceipt(text: string, today: Date): { receipt: Receipt | null; stripped: string } {
  for (const re of [RECEIPT_HTML, RECEIPT_TRAILING]) {
    const match = re.exec(text);
    if (!match) continue;
    const [, origin = '', owner = '', retest = ''] = match;
    return {
      receipt: { origin, owner, retest, retestDue: isPast(retest, today) },
      stripped: text.replace(re, '').trim(),
    };
  }
  return { receipt: null, stripped: text.trim() };
}

function isPast(retest: string, today: Date): boolean {
  const match = /(\d{4})-(\d{2})-(\d{2})/.exec(retest);
  if (!match) return false;
  const parsed = Date.parse(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  if (Number.isNaN(parsed)) return false;
  return parsed < Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
}

function checkablePatterns(text: string): string[] {
  return CHECKABLE_PATTERNS.filter((pattern) => pattern.re.test(text)).map((p) => p.name);
}

/**
 * Detect rules in one unit and attach them, plus any SUSPECT_PARSE warning.
 *
 * Frontmatter and fenced code blocks are excluded: an example in a code fence
 * is documentation of a rule, not a rule.
 */
export function detectRules(unit: ContextUnit, file: WalkedFile, today: Date): void {
  const lines = file.text.split('\n');
  let inFence = false;
  let inFrontmatter = false;
  let section = '';
  let ordinal = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';

    if (i === 0 && /^---\s*$/.test(line)) {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter) {
      if (/^---\s*$/.test(line)) inFrontmatter = false;
      continue;
    }
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      section = (heading[2] ?? '').trim();
      continue;
    }

    const listMatch = LIST_ITEM.exec(line);
    const body = listMatch ? (listMatch[1] ?? '') : line.trim();
    if (!body) continue;

    const modal = findModal(body);
    let detectedBy: Rule['detectedBy'] | null = null;
    if (modal) {
      detectedBy = 'modal';
    } else if (listMatch) {
      const firstWord = (/^[`*_"']*([A-Za-z][\w-]*)/.exec(body)?.[1] ?? '').toLowerCase();
      if (IMPERATIVE_SET.has(firstWord)) detectedBy = 'bulleted-imperative';
    }
    if (!detectedBy) continue;

    const { receipt, stripped } = parseReceipt(body, today);
    const tokens = normalizeTokens(stripped);
    if (tokens.length === 0) continue;

    unit.rules.push({
      unitPath: unit.path,
      line: i + 1,
      section,
      text: stripped,
      tokens,
      normalized: tokens.join(' '),
      receipt,
      checkable: checkablePatterns(stripped),
      ordinal: ordinal++,
      detectedBy,
    });
  }

  // Better to admit blindness than report a false clean (SPEC §5).
  if (unit.rules.length === 0 && unit.bytes >= SUSPECT_PARSE_MIN_BYTES) {
    unit.warnings.push(
      `SUSPECT_PARSE: ${unit.bytes} bytes, zero rules detected — heuristics may not match this file's format`,
    );
  }
}

export { findModal, parseReceipt, checkablePatterns };
