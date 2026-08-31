import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { collectSourceFiles, repoRelative } from './scan.ts';

/**
 * GDD §15 and CLAUDE.md §2.1: **the UI never computes game numbers.** If the
 * queue strip needs post-Weave damage, the sim exposes it — the view does not
 * multiply. P3 says the same thing from the other side: a computed value the
 * player cannot see is a design bug, and a value computed *in the view* is one
 * the sim cannot show them.
 *
 * The rule is easy to keep while writing a view and easy to lose while fixing
 * one, which is exactly the kind of rule that belongs in a test rather than in
 * a reviewer's memory. M1 tripled the number of derived figures on screen — a
 * multiplier per tag, a socket price, a resolved Weight — so it is worth
 * enforcing now rather than after the drift.
 */

const ROOT = join(import.meta.dirname, '..', '..');
const UI_DIR = join(ROOT, 'src', 'ui');

/**
 * Arithmetic on something that reads like a game number. Layout maths is fine
 * and unavoidable — a view has to place things — so the rule is scoped to the
 * vocabulary of the *rules* rather than to arithmetic in general.
 */
const GAME_NUMBERS =
  /\b(damage|weight|recovery|guard|poise|multiplier|saturation|resist|maxHp|insight|stagger|attunement)\b/i;

const OPERATOR = /[*/]|\s[+-]\s/;

/** Places a view is allowed to do arithmetic, because it is about the screen. */
const LAYOUT_WORDS =
  /\b(x|y|width|height|offset|left|top|centre|center|index|count|row|column|slot|pixel|ms|alpha|angle|scale|depth|spread|padEnd|length|repeat|toFixed)\b/i;

/**
 * A fraction shown as a percentage. Not a game computation — the same value in
 * different notation, like ticks and milliseconds — and forbidding it would
 * push a `chance` of 0.45 onto the screen as "0.45", which serves nobody.
 */
const PERCENT = /\*\s*100\b/;

interface Offence {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

/**
 * Strings and import paths carry slashes and dashes that are punctuation, not
 * operators — `HP 66 / 70` is a caption. Removing them first is what keeps this
 * guard from crying wolf, and a guard that cries wolf gets deleted.
 */
function code(line: string): string {
  return line
    .replace(/'[^']*'/g, "''")
    .replace(/"[^"]*"/g, '""')
    .replace(/`[^`]*`/g, '``');
}

function offences(content: string, path: string): readonly Offence[] {
  const found: Offence[] = [];

  for (const [index, raw] of content.split('\n').entries()) {
    const line = raw.trim();
    if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) continue;
    if (line.startsWith('import ') || line.startsWith('export ')) continue;

    const bare = code(line);
    if (!OPERATOR.test(bare) || PERCENT.test(bare)) continue;
    if (!GAME_NUMBERS.test(bare) || LAYOUT_WORDS.test(bare)) continue;

    found.push({ file: path, line: index + 1, text: line });
  }

  return found;
}

describe('the UI computes no game numbers (CLAUDE.md §2.1, GDD §15)', () => {
  it('does arithmetic on layout, never on rules', () => {
    const caught = collectSourceFiles(UI_DIR).flatMap((file) =>
      offences(file.content, repoRelative(ROOT, file.path)),
    );

    expect(caught).toEqual([]);
  });

  it('catches a view that works out its own damage', () => {
    const guilty = `const shown = card.damage * weave.multiplier;`;
    expect(offences(guilty, 'fake.ts')).toHaveLength(1);
  });

  it('leaves a view placing a card alone', () => {
    const innocent = `const x = LAYOUT.width / 2 + index * (cardWidth + gap);`;
    expect(offences(innocent, 'fake.ts')).toEqual([]);
  });
});
