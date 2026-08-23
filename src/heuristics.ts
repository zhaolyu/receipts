/**
 * Every `IMPL CHOICE` in SPEC.md resolves here, in one file, so the report
 * footer can print the exact sets in use and a reader can audit them without
 * reading the detector.
 *
 * Changing anything in this file changes findings. That is the point: the
 * heuristics are the tool's opinion, and an opinion you cannot see is not
 * auditable.
 */

/** SPEC §3.1 — token estimate. Stated in the footer, never silently assumed. */
export const TOKEN_BYTES_PER_TOKEN = 4;

/** SPEC §1 — duplicate-pair threshold. Printed in the report (§3.2). */
export const SIMILARITY_THRESHOLD = 0.7;

/** SPEC §4 — files above this are skipped, named, never silently dropped. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** SPEC §2 — default resident-token budget. */
export const DEFAULT_BUDGET = 40_000;

/** SPEC §2 — default walk cap. Exceeding it is reported, never silent. */
export const DEFAULT_MAX_FILES = 500;

/**
 * SPEC §5 — "zero rules detected in a large instruction file" raises
 * SUSPECT_PARSE. "Large" needs a number; this is it.
 */
export const SUSPECT_PARSE_MIN_BYTES = 2_000;

/** SPEC §3.4 — `probation` needs a staleness cutoff. */
export const STALE_DAYS = 90;

/**
 * Rule detection, SPEC §1. Precision over recall: undercounting rules is
 * acceptable, miscounting prose as a rule is not.
 *
 * A line is a rule when EITHER:
 *   (a) it contains a modal token below, uppercase, as a whole word; or
 *   (b) it is a list item whose first word is an imperative verb below.
 *
 * Free prose without a modal is never a rule, even when it opens with an
 * imperative verb. That is the deliberate precision/recall trade: a sentence
 * like "Use deploy for production pushes." in a Notes paragraph reads as
 * description, and counting it would inflate every unreceipted-rule count.
 */
export const MODAL_TOKENS = [
  'MUST NOT',
  'MUST',
  'SHALL NOT',
  'SHALL',
  'NEVER',
  'ALWAYS',
  'DO NOT',
  'DON’T',
  'REQUIRED',
  'FORBIDDEN',
] as const;

export const IMPERATIVE_VERBS = [
  'add', 'apply', 'avoid', 'build', 'call', 'check', 'cite', 'commit',
  'configure', 'confirm', 'create', 'declare', 'delete', 'deploy', 'describe',
  'disable', 'document', 'emit', 'enable', 'ensure', 'exclude', 'fail',
  'flag', 'follow', 'handle', 'ignore', 'include', 'install', 'keep', 'list',
  'load', 'log', 'make', 'name', 'note', 'open', 'pass', 'prefer', 'print',
  'push', 'read', 'record', 'refuse', 'reject', 'remove', 'rename', 'render',
  'replace', 'report', 'require', 'return', 'review', 'run', 'scope', 'set',
  'skip', 'sort', 'start', 'stop', 'store', 'tag', 'test', 'treat', 'update',
  'use', 'validate', 'verify', 'wait', 'write',
] as const;

/**
 * Stopwords dropped before Jaccard comparison (SPEC §1). Without this,
 * two wordings of one rule score below threshold purely on filler, and the
 * DIVERGED case the report exists to surface never fires.
 */
export const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'than', 'that', 'this',
  'these', 'those', 'is', 'are', 'be', 'been', 'was', 'were', 'to', 'of', 'in',
  'on', 'at', 'by', 'for', 'from', 'with', 'as', 'it', 'its', 'you', 'your',
  'we', 'our', 'any', 'all', 'when', 'while', 'into', 'including', 'include',
  'also', 'do', 'does', 'not', 'no', 'so', 'such', 'via', 'per', 'up', 'out',
]);

/**
 * Mechanically-checkable rule patterns (SPEC §3.4, `turn-into-check`).
 * A rule matching any of these states a condition a script could evaluate,
 * which is the argument for moving it out of the prompt and into CI.
 */
export const CHECKABLE_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  {
    name: 'numeric-comparison',
    re: /(?:under|over|below|above|at least|at most|no more than|no fewer than|fewer than|less than|greater than|max(?:imum)?|min(?:imum)?|[<>]=?|≤|≥)\s*\d/i,
  },
  {
    name: 'numeric-with-unit',
    re: /\b\d+\s*(?:words?|characters?|chars?|lines?|bytes?|kb|mb|tokens?|seconds?|minutes?|ms)\b/i,
  },
  {
    name: 'absence-assertion',
    re: /\bno\s+[\w-]+\s+(?:appear|appears|allowed|permitted|present|exist|exists)\b/i,
  },
  {
    name: 'universal-assertion',
    re: /\b(?:all|every|each)\s+[\w-]+\s+(?:carry|carries|have|has|include|includes|contain|contains)\b/i,
  },
  {
    name: 'path-existence',
    re: /\b(?:file|path|directory|dir)\b[^.]*\b(?:exists?|present|missing|absent)\b/i,
  },
  {
    name: 'format-assertion',
    re: /\b(?:valid|well-formed|matches?|conforms? to)\s+(?:json|yaml|toml|csv|regex|pattern|schema|format)\b/i,
  },
];

/** Directories never walked. Not context surface; walking them wastes the cap. */
export const IGNORED_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', 'coverage', '.next',
  '.turbo', '.cache', 'vendor', 'target', '__pycache__', '.venv', 'venv',
  '.pytest_cache', '.mypy_cache', '.gradle', '.idea', '.vscode',
]);

/**
 * Directory names that mark context surface. A file counts as a candidate
 * when it sits at the repo root or under one of these at any depth.
 */
export const CONTEXT_DIRS = new Set([
  '.claude', '.agents', '.cursor', '.github',
  'skills', 'agents', 'commands', 'rules', 'prompts',
]);

/** Extensions that are assets, never instruction text. Not read, not reported. */
export const ASSET_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.tiff',
  '.pdf', '.zip', '.tar', '.gz', '.tgz', '.bz2', '.xz', '.7z', '.rar',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp3', '.mp4', '.mov', '.avi', '.webm', '.wav',
  '.lock', '.map', '.wasm', '.node', '.so', '.dylib', '.dll', '.exe',
]);

/** Basenames treated as a repo's root instruction file. */
export const ROOT_INSTRUCTION_FILES = new Set([
  'CLAUDE.md', 'AGENTS.md', 'GEMINI.md', 'CONVENTIONS.md', '.cursorrules',
]);

/**
 * SPEC §3.2 — the tool's precedence model, printed in the report alongside
 * the reminder that it is the tool's model and not a runtime guarantee.
 *
 * Lower rank wins. Within one unit, later-in-file beats earlier. Between two
 * units of equal rank the tool declares the lexicographically-first path the
 * winner, which is arbitrary but stable — and saying so is the honest move.
 */
export const KIND_RANK: Record<string, number> = {
  root: 0,
  included: 1,
  rule: 2,
  command: 3,
  agent: 4,
  skill: 5,
};

export const PRECEDENCE_MODEL_DESCRIPTION =
  'root file beats included file beats rule beats command beats agent beats skill; ' +
  'within one unit, later-in-file beats earlier; ties broken by lexicographic path';
