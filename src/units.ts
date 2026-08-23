import { posix } from 'node:path';
import { ROOT_INSTRUCTION_FILES, TOKEN_BYTES_PER_TOKEN } from './heuristics.ts';
import type { ContextUnit, UnitKind } from './types.ts';
import type { WalkedFile } from './walk.ts';

export interface UnitsOutput {
  units: ContextUnit[];
  /** Each cycle reported once, as the path list that closes the loop. */
  cycles: string[][];
}

/**
 * Classification is by location and include-graph, never by content (SPEC §1).
 * Returns null for a readable file that is not a context unit — an ordinary
 * doc sitting in the tree is not part of the context surface.
 */
function classify(relPath: string): UnitKind | null {
  const base = posix.basename(relPath);
  const segments = relPath.split('/');
  const dirs = segments.slice(0, -1);

  if (segments.length === 1 && ROOT_INSTRUCTION_FILES.has(base)) return 'root';
  // .claude/CLAUDE.md and .agents/AGENTS.md are root instruction files too.
  if (
    segments.length === 2 &&
    (dirs[0] === '.claude' || dirs[0] === '.agents') &&
    ROOT_INSTRUCTION_FILES.has(base)
  ) {
    return 'root';
  }
  if (base === 'SKILL.md') return 'skill';
  if (dirs.includes('agents') && base.endsWith('.md')) return 'agent';
  if (dirs.includes('commands') && base.endsWith('.md')) return 'command';
  if (dirs.includes('rules') && base.endsWith('.md')) return 'rule';
  return null;
}

/**
 * Frontmatter `name:`, when the file opens with a `---` block. Hand-parsed:
 * the field is a flat scalar, and a YAML dependency would add a behavior
 * surface this tool would then have to document.
 */
function declaredName(text: string): string | null {
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return null;
  const block = text.slice(3, end);
  for (const line of block.split('\n')) {
    const match = /^\s*name\s*:\s*(.+?)\s*$/.exec(line);
    if (match && match[1]) return match[1].replace(/^["']|["']$/g, '');
  }
  return null;
}

/**
 * Include directives: `@include <path>` and bare `@<path>`, resolved relative
 * to the directory of the file that contains them.
 */
export function parseIncludes(unitPath: string, text: string): string[] {
  const out: string[] = [];
  const dir = posix.dirname(unitPath);
  const lines = text.split('\n');
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const re = /(?:^|\s)@(?:include\s+)?([./\w-]+\.[\w]+)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(line)) !== null) {
      const target = match[1];
      if (!target) continue;
      const resolved = posix.normalize(dir === '.' ? target : posix.join(dir, target));
      if (!resolved.startsWith('..')) out.push(resolved);
    }
  }
  return out;
}

/**
 * Build context units and resolve residency.
 *
 * Resident = root instruction files plus their transitive `@`-includes.
 * Everything else is on-demand. Cycle detection is a colored DFS: a back edge
 * records the loop once and stops, so `a → b → a` terminates.
 */
export function buildUnits(files: WalkedFile[]): UnitsOutput {
  const byPath = new Map<string, WalkedFile>();
  for (const file of files) byPath.set(file.path, file);

  const units: ContextUnit[] = [];
  const unitByPath = new Map<string, ContextUnit>();

  for (const file of files) {
    const kind = classify(file.path);
    if (kind === null) continue;
    const unit: ContextUnit = {
      path: file.path,
      kind,
      residency: 'on-demand',
      bytes: file.bytes,
      tokens: Math.ceil(file.bytes / TOKEN_BYTES_PER_TOKEN),
      declaredName: declaredName(file.text),
      rules: [],
      warnings: [],
      inboundRefs: 0,
      mtimeMs: file.mtimeMs,
    };
    units.push(unit);
    unitByPath.set(file.path, unit);
  }

  // Roots are resident by definition; walk their include graph for the rest.
  const cycles: string[][] = [];
  const seenCycleKeys = new Set<string>();
  const globallyVisited = new Set<string>();

  const roots = units.filter((unit) => unit.kind === 'root');
  for (const root of roots) {
    root.residency = 'resident';
    visit(root.path, [root.path]);
  }

  function visit(path: string, stack: string[]): void {
    const file = byPath.get(path);
    if (!file) return;
    for (const target of parseIncludes(path, file.text)) {
      const cycleAt = stack.indexOf(target);
      if (cycleAt !== -1) {
        const loop = [...stack.slice(cycleAt), target];
        // Rotation-independent key, so one loop is reported once however entered.
        const key = [...loop.slice(0, -1)].sort().join('|');
        if (!seenCycleKeys.has(key)) {
          seenCycleKeys.add(key);
          cycles.push(loop);
        }
        continue;
      }
      const targetFile = byPath.get(target);
      if (!targetFile) continue;

      let targetUnit = unitByPath.get(target);
      if (!targetUnit) {
        // An included file is a context unit by virtue of being included.
        targetUnit = {
          path: target,
          kind: 'included',
          residency: 'resident',
          bytes: targetFile.bytes,
          tokens: Math.ceil(targetFile.bytes / TOKEN_BYTES_PER_TOKEN),
          declaredName: declaredName(targetFile.text),
          rules: [],
          warnings: [],
          inboundRefs: 0,
          mtimeMs: targetFile.mtimeMs,
        };
        units.push(targetUnit);
        unitByPath.set(target, targetUnit);
      }
      targetUnit.residency = 'resident';

      if (globallyVisited.has(target)) continue;
      globallyVisited.add(target);
      visit(target, [...stack, target]);
    }
  }

  units.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  cycles.sort((a, b) => (a.join('|') < b.join('|') ? -1 : 1));
  return { units, cycles };
}

/**
 * Inbound references, used by the `retire` disposition (SPEC §3.4).
 *
 * A unit is referenced when another unit's text mentions its path, its
 * containing directory name (for `skills/<name>/SKILL.md`), or its declared
 * frontmatter name as a whole word.
 */
export function countInboundRefs(units: ContextUnit[], files: WalkedFile[]): void {
  const textByPath = new Map(files.map((file) => [file.path, file.text]));

  for (const unit of units) {
    const needles = new Set<string>([unit.path]);
    const dir = posix.basename(posix.dirname(unit.path));
    if (unit.path.endsWith('/SKILL.md') && dir) needles.add(dir);
    if (unit.declaredName) needles.add(unit.declaredName);

    let count = 0;
    for (const other of units) {
      if (other.path === unit.path) continue;
      const text = textByPath.get(other.path);
      if (!text) continue;
      for (const needle of needles) {
        if (!needle) continue;
        const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp(`(^|[^\\w/-])${escaped}([^\\w-]|$)`).test(text)) {
          count += 1;
          break;
        }
      }
    }
    unit.inboundRefs = count;
  }
}

export { classify, declaredName };
