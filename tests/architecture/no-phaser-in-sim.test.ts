import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { collectSourceFiles, forbiddenImports, loadFixture, repoRelative } from './scan.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const SIM_DIR = join(ROOT, 'src', 'sim');
const FIXTURES = join(import.meta.dirname, 'fixtures');

describe('the /sim boundary (CLAUDE.md §2.1, GDD §20.1)', () => {
  it('imports no Phaser and no rendering or run layer', () => {
    const offenders = collectSourceFiles(SIM_DIR)
      .map((file) => ({ path: repoRelative(ROOT, file.path), bad: forbiddenImports(file) }))
      .filter((result) => result.bad.length > 0);

    expect(offenders).toEqual([]);
  });

  it('catches a violation when one exists', () => {
    expect(forbiddenImports(loadFixture(FIXTURES, 'phaser-import.fixture'))).toEqual([
      'phaser',
      '../ui/QueueStrip',
      '../run/RunState',
    ]);
  });

  it('does not flag a clean module', () => {
    expect(forbiddenImports(loadFixture(FIXTURES, 'clean.fixture'))).toEqual([]);
  });
});
