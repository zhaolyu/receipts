/** Shared plain-data shapes. Every pipeline stage takes and returns these. */

export type Residency = 'resident' | 'on-demand';

export type UnitKind = 'root' | 'included' | 'rule' | 'command' | 'agent' | 'skill';

export type Disposition =
  | 'keep'
  | 'one-home'
  | 'load-later'
  | 'turn-into-check'
  | 'probation'
  | 'retire';

/** Errors are values. Only bin/receipts.ts turns one into an exit code. */
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; message: string };

export interface SkippedFile {
  /** Repo-relative, POSIX separators. */
  path: string;
  reason: string;
}

export interface Receipt {
  origin: string;
  owner: string;
  retest: string;
  /** True when `retest` parses as a date and that date is in the past. */
  retestDue: boolean;
}

export interface Rule {
  unitPath: string;
  /** 1-indexed line within the unit. */
  line: number;
  /** Nearest enclosing markdown heading, '' above the first heading. */
  section: string;
  /** Rule text with any receipt annotation removed. */
  text: string;
  /** Normalized comparison tokens (lowercased, destopworded, depluralized). */
  tokens: string[];
  /** Normalized token sequence, joined — used for the DIVERGED test. */
  normalized: string;
  receipt: Receipt | null;
  /** Names of the checkable patterns this rule matches; empty when none. */
  checkable: string[];
  /** Index of this rule within its unit, ascending. Later beats earlier. */
  ordinal: number;
  /** Which heuristic fired, for the footer's accounting. */
  detectedBy: 'modal' | 'bulleted-imperative';
}

export interface ContextUnit {
  path: string;
  kind: UnitKind;
  residency: Residency;
  bytes: number;
  tokens: number;
  /** Skill/agent frontmatter `name`, when present. Used for inbound refs. */
  declaredName: string | null;
  rules: Rule[];
  /** Unit-level warnings, e.g. SUSPECT_PARSE. */
  warnings: string[];
  /** Count of other units whose text references this one. */
  inboundRefs: number;
  mtimeMs: number;
}

export interface DuplicatePair {
  a: Rule;
  b: Rule;
  similarity: number;
  diverged: boolean;
  /** The rule that wins under the tool's precedence model. */
  winnerPath: string;
  winnerLine: number;
}

export interface UnitDisposition {
  unitPath: string;
  disposition: Disposition;
  /** The mechanical trigger that fired, verbatim from the SPEC §3.4 table. */
  trigger: string;
}

export interface AuditTotals {
  residentTokens: number;
  onDemandTokens: number;
  budget: number;
  /** residentTokens / budget, rounded to 2dp. */
  budgetRatio: number;
  overBudget: boolean;
  ruleCount: number;
  receiptedRules: number;
  unreceiptedRules: number;
  retestDueRules: number;
}

export interface AuditResult {
  repoPath: string;
  units: ContextUnit[];
  skipped: SkippedFile[];
  /** Each detected include cycle, as the path list that closes the loop. */
  cycles: string[][];
  pairs: DuplicatePair[];
  dispositions: UnitDisposition[];
  totals: AuditTotals;
  /** Walk-level notes: max-files cap hit, and similar. Never silent. */
  notes: string[];
  /** Exit code 1 when > 0. See SPEC §2. */
  findings: number;
}
