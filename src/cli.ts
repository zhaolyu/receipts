import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { audit } from './audit.ts';
import { DEFAULT_BUDGET, DEFAULT_MAX_FILES } from './heuristics.ts';
import { renderJson, renderText } from './render.ts';

export interface CliOutcome {
  stdout: string;
  stderr: string;
  exitCode: 0 | 1 | 2;
}

const USAGE =
  'usage: receipts audit <repo-path> [--budget N] [--format text|json] ' +
  '[--max-files N] [--out PATH]';

/**
 * Parse, run, render. Returns an outcome; the entry file is the only place
 * that calls process.exit (CLAUDE.md style rule).
 *
 * `now` is injectable so tests and fixture runs never depend on the wall clock.
 */
export function run(argv: string[], now: Date = new Date()): CliOutcome {
  const [command, ...rest] = argv;

  if (command === undefined || command === '--help' || command === '-h') {
    return { stdout: USAGE + '\n', stderr: '', exitCode: command === undefined ? 2 : 0 };
  }
  if (command !== 'audit') {
    return { stdout: '', stderr: `unknown command: ${command}\n${USAGE}\n`, exitCode: 2 };
  }

  let repoPath: string | undefined;
  let budget = DEFAULT_BUDGET;
  let maxFiles = DEFAULT_MAX_FILES;
  let format: 'text' | 'json' = 'text';
  let outPath: string | undefined;

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i] as string;
    if (arg === '--budget' || arg === '--max-files' || arg === '--format' || arg === '--out') {
      const value = rest[i + 1];
      if (value === undefined) {
        return { stdout: '', stderr: `${arg} needs a value\n${USAGE}\n`, exitCode: 2 };
      }
      i += 1;
      if (arg === '--budget') {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < 0) {
          return { stdout: '', stderr: `--budget must be a non-negative number\n`, exitCode: 2 };
        }
        budget = parsed;
      } else if (arg === '--max-files') {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          return { stdout: '', stderr: `--max-files must be a positive integer\n`, exitCode: 2 };
        }
        maxFiles = parsed;
      } else if (arg === '--format') {
        if (value !== 'text' && value !== 'json') {
          return { stdout: '', stderr: `--format must be text or json\n`, exitCode: 2 };
        }
        format = value;
      } else {
        outPath = resolve(value);
      }
      continue;
    }
    if (arg.startsWith('-')) {
      return { stdout: '', stderr: `unknown flag: ${arg}\n${USAGE}\n`, exitCode: 2 };
    }
    if (repoPath !== undefined) {
      return { stdout: '', stderr: `unexpected argument: ${arg}\n${USAGE}\n`, exitCode: 2 };
    }
    repoPath = arg;
  }

  if (repoPath === undefined) {
    return { stdout: '', stderr: `audit needs a repo path\n${USAGE}\n`, exitCode: 2 };
  }

  const result = audit({ repoPath, budget, maxFiles, now, outPath });
  if (!result.ok) {
    // A check that cannot run exits 2. Never fail open (SPEC §2).
    return { stdout: '', stderr: `${result.code}: ${result.message}\n`, exitCode: 2 };
  }

  const timestamp = now.toISOString();
  const report =
    format === 'json'
      ? renderJson(result.value, timestamp)
      : renderText(result.value, timestamp);

  if (outPath !== undefined) {
    try {
      writeFileSync(outPath, report, 'utf8');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { stdout: '', stderr: `WRITE_FAILED: ${message}\n`, exitCode: 2 };
    }
    return {
      stdout: `report written to ${outPath}\n`,
      stderr: '',
      exitCode: result.value.findings > 0 ? 1 : 0,
    };
  }

  return { stdout: report, stderr: '', exitCode: result.value.findings > 0 ? 1 : 0 };
}

export { USAGE };
