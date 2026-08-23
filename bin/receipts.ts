#!/usr/bin/env node
/**
 * Entry point. The only place in the codebase that calls process.exit —
 * everything below it returns errors as values (CLAUDE.md style rule).
 */
import { run } from '../src/cli.ts';

const outcome = run(process.argv.slice(2));
if (outcome.stdout) process.stdout.write(outcome.stdout);
if (outcome.stderr) process.stderr.write(outcome.stderr);
process.exit(outcome.exitCode);
