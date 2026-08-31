import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export interface SourceFile {
  readonly path: string;
  readonly content: string;
}

/** Recursively collects files under `dir` whose name ends with `extension`. */
export function collectSourceFiles(dir: string, extension = '.ts'): SourceFile[] {
  const found: SourceFile[] = [];

  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.endsWith(extension)) {
        found.push({ path: full, content: readFileSync(full, 'utf8') });
      }
    }
  };

  walk(dir);
  return found;
}

/**
 * Comment lines are skipped before matching, so a rule can be *named* in a doc
 * comment without tripping the guard that enforces it.
 */
function codeLines(content: string): string[] {
  return content.split('\n').filter((line) => {
    const trimmed = line.trimStart();
    return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
  });
}

const SPECIFIER_PATTERNS: readonly RegExp[] = [
  /\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\s+['"]([^'"]+)['"]/g,
];

function isDefined(value: string | undefined): value is string {
  return value !== undefined;
}

/** Every module specifier the file imports, in source order. */
export function importedModules(file: SourceFile): string[] {
  const code = codeLines(file.content).join('\n');

  return SPECIFIER_PATTERNS.flatMap((pattern) =>
    [...code.matchAll(pattern)].map((match) => match[1]).filter(isDefined),
  );
}

/**
 * `data` and `platform` join the list on a property that is already true:
 * a relic table or a boss statline reaching the reducer would invert the
 * layering GDD §20.1 draws, and `/platform` is where the async, browser-only
 * things live. Pinning a property while it holds is cheaper than restoring it.
 */
const FORBIDDEN_LAYERS = ['ui', 'scenes', 'run', 'data', 'platform'] as const;

/** CLAUDE.md §2.1 / GDD §20.1: /sim imports no engine and no rendering layer. */
export function forbiddenImports(file: SourceFile): string[] {
  return importedModules(file).filter((specifier) => {
    if (specifier === 'phaser' || specifier.startsWith('phaser/')) return true;
    const segments = specifier.split('/');
    return FORBIDDEN_LAYERS.some((layer) => segments.includes(layer));
  });
}

interface AmbientRule {
  readonly name: string;
  readonly pattern: RegExp;
}

const AMBIENT_RULES: readonly AmbientRule[] = [
  { name: 'Math.random', pattern: /\bMath\s*\.\s*random\b/ },
  { name: 'Date', pattern: /\bnew\s+Date\b|\bDate\s*\.\s*now\b/ },
  { name: 'performance', pattern: /\bperformance\s*\.\s*now\b/ },
  { name: 'setTimeout / setInterval', pattern: /\bset(?:Timeout|Interval)\s*\(/ },
  { name: 'crypto', pattern: /\bcrypto\s*\.\s*(?:getRandomValues|randomUUID)\b/ },
  { name: 'turn/round duration', pattern: /\b(?:duration|timer|expires?)In(?:Turns|Rounds|Ms)\b/i },
];

/**
 * CLAUDE.md §2.1 and GDD §2 (P6): /sim has no ambient clock and no ambient
 * randomness, and expresses no duration in anything but ticks.
 */
export function ambientTimeOrRandomUses(file: SourceFile): string[] {
  const code = codeLines(file.content).join('\n');
  return AMBIENT_RULES.filter((rule) => rule.pattern.test(code)).map((rule) => rule.name);
}

/** Path relative to the repo root, for readable failure messages. */
export function repoRelative(root: string, path: string): string {
  return relative(root, path).split(sep).join('/');
}

/** Loads a named architecture fixture, failing loudly if it has gone missing. */
export function loadFixture(dir: string, name: string): SourceFile {
  const file = collectSourceFiles(dir, '.fixture').find((candidate) =>
    candidate.path.endsWith(name),
  );
  if (file === undefined) throw new Error(`architecture fixture not found: ${name}`);
  return file;
}
