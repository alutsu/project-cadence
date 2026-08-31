import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { ambientTimeOrRandomUses, collectSourceFiles, loadFixture, repoRelative } from './scan.ts';

const ROOT = join(import.meta.dirname, '..', '..');
/**
 * `/run` is scanned too. It is not `/sim`, but it is pure by design — the
 * harness and every run test must work without a browser or a clock, and a
 * save envelope's timestamp is exactly the kind of thing that would drift in
 * (docs/M2_PLAN.md). The rule it must keep is the same one.
 */
const PURE_DIRS = [join(ROOT, 'src', 'sim'), join(ROOT, 'src', 'run')];
const FIXTURES = join(import.meta.dirname, 'fixtures');

describe('/sim determinism (CLAUDE.md §2.1, GDD §2 P6, §20.2)', () => {
  it('uses no ambient clock and no ambient randomness', () => {
    const offenders = PURE_DIRS.flatMap((dir) => collectSourceFiles(dir))
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
