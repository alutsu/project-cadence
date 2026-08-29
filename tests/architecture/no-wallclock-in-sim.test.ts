import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { ambientTimeOrRandomUses, collectSourceFiles, loadFixture, repoRelative } from './scan';

const ROOT = join(import.meta.dirname, '..', '..');
const SIM_DIR = join(ROOT, 'src', 'sim');
const FIXTURES = join(import.meta.dirname, 'fixtures');

describe('/sim determinism (CLAUDE.md §2.1, GDD §2 P6, §20.2)', () => {
  it('uses no ambient clock and no ambient randomness', () => {
    const offenders = collectSourceFiles(SIM_DIR)
      .map((file) => ({ path: repoRelative(ROOT, file.path), bad: ambientTimeOrRandomUses(file) }))
      .filter((result) => result.bad.length > 0);

    expect(offenders).toEqual([]);
  });

  it('catches a violation when one exists', () => {
    expect(ambientTimeOrRandomUses(loadFixture(FIXTURES, 'wallclock.fixture'))).toEqual([
      'Math.random',
      'Date',
      'performance',
      'setTimeout / setInterval',
    ]);
  });

  it('does not flag a clean module, even one whose comments name the forbidden APIs', () => {
    expect(ambientTimeOrRandomUses(loadFixture(FIXTURES, 'clean.fixture'))).toEqual([]);
  });
});
