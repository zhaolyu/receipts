import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep, extname, basename } from 'node:path';
import {
  ASSET_EXTENSIONS,
  CONTEXT_DIRS,
  IGNORED_DIRS,
  MAX_FILE_BYTES,
} from './heuristics.ts';
import type { Result, SkippedFile } from './types.ts';

export interface WalkedFile {
  /** Repo-relative, POSIX separators. */
  path: string;
  absPath: string;
  bytes: number;
  text: string;
  mtimeMs: number;
}

export interface WalkOutput {
  files: WalkedFile[];
  skipped: SkippedFile[];
  notes: string[];
}

/** POSIX-normalized relative path, so reports are identical across platforms. */
function toPosix(p: string): string {
  return p.split(sep).join('/');
}

/**
 * A file is candidate context surface when it sits at the repo root or under a
 * CONTEXT_DIRS directory at any depth, and its extension is not a known asset.
 *
 * Unknown extensions are candidates on purpose. `blob.bin` next to a CLAUDE.md
 * is exactly the file an audit must not pretend it read: we attempt it, fail on
 * size or on NUL bytes, and say so. Guessing from the extension that it was
 * uninteresting would be the silent-coverage failure the spec forbids.
 */
function isCandidate(relPath: string): boolean {
  if (ASSET_EXTENSIONS.has(extname(relPath).toLowerCase())) return false;
  const segments = relPath.split('/');
  if (segments.length === 1) return true;
  return segments.slice(0, -1).some((segment) => CONTEXT_DIRS.has(segment));
}

/** Binary sniff: a NUL byte in the first 8 KB. Cheap and good enough. */
function looksBinary(buffer: Buffer): boolean {
  const window = buffer.subarray(0, Math.min(buffer.length, 8192));
  return window.includes(0);
}

/**
 * Walk the repo's context surface in sorted path order (SPEC §4).
 *
 * Returns a Result because a bad path is an exit-2 condition, not a finding.
 */
export function walk(repoPath: string, maxFiles: number): Result<WalkOutput> {
  let rootStat;
  try {
    rootStat = statSync(repoPath);
  } catch {
    return { ok: false, code: 'BAD_PATH', message: `cannot stat: ${repoPath}` };
  }
  if (!rootStat.isDirectory()) {
    return { ok: false, code: 'BAD_PATH', message: `not a directory: ${repoPath}` };
  }

  const candidates: string[] = [];
  const skipped: SkippedFile[] = [];
  const notes: string[] = [];

  const stack: string[] = [repoPath];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      skipped.push({ path: toPosix(relative(repoPath, dir)), reason: 'unreadable directory' });
      continue;
    }
    // Sort so traversal order — and therefore report order — is deterministic.
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        stack.push(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = toPosix(relative(repoPath, abs));
      if (isCandidate(rel)) candidates.push(rel);
    }
  }

  candidates.sort();

  let considered = candidates;
  if (candidates.length > maxFiles) {
    considered = candidates.slice(0, maxFiles);
    // Never a silent truncation: an unreported cap reads as full coverage.
    notes.push(
      `MAX_FILES_REACHED: ${candidates.length} candidate files, --max-files ${maxFiles}. ` +
        `${candidates.length - maxFiles} not examined.`,
    );
  }

  const files: WalkedFile[] = [];
  for (const rel of considered) {
    const abs = join(repoPath, rel);
    let stats;
    try {
      stats = statSync(abs);
    } catch {
      skipped.push({ path: rel, reason: 'unreadable' });
      continue;
    }
    if (stats.size > MAX_FILE_BYTES) {
      skipped.push({
        path: rel,
        reason: `exceeds ${MAX_FILE_BYTES} bytes (${stats.size})`,
      });
      continue;
    }
    let buffer: Buffer;
    try {
      buffer = readFileSync(abs);
    } catch {
      skipped.push({ path: rel, reason: 'unreadable' });
      continue;
    }
    if (looksBinary(buffer)) {
      skipped.push({ path: rel, reason: 'binary (NUL byte in first 8 KB)' });
      continue;
    }
    files.push({
      path: rel,
      absPath: abs,
      bytes: stats.size,
      text: buffer.toString('utf8'),
      mtimeMs: stats.mtimeMs,
    });
  }

  skipped.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { ok: true, value: { files, skipped, notes } };
}

export { toPosix, isCandidate, basename };
