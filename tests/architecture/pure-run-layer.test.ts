import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { collectSourceFiles, importedModules, repoRelative } from './scan.ts';

/**
 * `/run` is pure (GDD §20.1's tree, CLAUDE.md §2.1).
 *
 * It is not `/sim` — it holds randomness, it owns the streams, and it decides
 * things. But it must stay **synchronous, headless and Phaser-free**, because
 * the balance harness plays whole runs through it and every run test has to
 * work without a browser.
 *
 * The specific thing this guard exists to stop: `/run/save.ts` reaching for
 * IndexedDB. Serializing a run is pure; storing it is not, and §16's store
 * lives in `/src/platform` behind an adapter. That boundary is one import away
 * from vanishing and nothing else would notice.
 */

const ROOT = join(import.meta.dirname, '..', '..');
const RUN_DIR = join(ROOT, 'src', 'run');

const FORBIDDEN_LAYERS: readonly string[] = ['ui', 'scenes', 'platform'];

/** Browser globals a pure layer must not reach for. */
const BROWSER_GLOBALS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: 'indexedDB', pattern: /\bindexedDB\b/ },
  { name: 'window', pattern: /\bwindow\s*\./ },
  { name: 'document', pattern: /\bdocument\s*\./ },
  { name: 'localStorage', pattern: /\blocalStorage\b/ },
  { name: 'fetch', pattern: /\bfetch\s*\(/ },
];

function codeOf(content: string): string {
  return content
    .split('\n')
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
    })
    .join('\n');
}

export function forbiddenRunImports(content: string): readonly string[] {
  return importedModules({ path: 'x.ts', content }).filter((specifier) => {
    if (specifier === 'phaser' || specifier.startsWith('phaser/')) return true;
    const segments = specifier.split('/');
    return FORBIDDEN_LAYERS.some((layer) => segments.includes(layer));
  });
}

export function browserGlobalsIn(content: string): readonly string[] {
  const code = codeOf(content);
  return BROWSER_GLOBALS.filter((rule) => rule.pattern.test(code)).map((rule) => rule.name);
}

describe('the /run layer stays pure (CLAUDE.md §2.1, GDD §16, §20.1)', () => {
  it('imports no Phaser, no rendering layer, and no platform adapter', () => {
    const offenders = collectSourceFiles(RUN_DIR)
      .map((file) => ({
        path: repoRelative(ROOT, file.path),
        bad: forbiddenRunImports(file.content),
      }))
      .filter((result) => result.bad.length > 0);

    expect(offenders).toEqual([]);
  });

  it('reaches for no browser global', () => {
    const offenders = collectSourceFiles(RUN_DIR)
      .map((file) => ({
        path: repoRelative(ROOT, file.path),
        bad: browserGlobalsIn(file.content),
      }))
      .filter((result) => result.bad.length > 0);

    expect(offenders).toEqual([]);
  });

  it('catches a save module that reaches for the database itself', () => {
    const guilty = `const request = indexedDB.open('cadence', 1);`;
    expect(browserGlobalsIn(guilty)).toEqual(['indexedDB']);
    expect(forbiddenRunImports(`import { saveStore } from '../platform/saveStore.ts';`)).toEqual([
      '../platform/saveStore.ts',
    ]);
  });

  it('does not flag a module that only names the forbidden things in prose', () => {
    const innocent = `// IndexedDB is async and browser-only, so it lives in /platform.\nexport const x = 1;`;
    expect(browserGlobalsIn(innocent)).toEqual([]);
  });
});
