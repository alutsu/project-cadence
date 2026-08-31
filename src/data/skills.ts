import type { CardCatalogue, CardDefinition } from '../sim/card.ts';
import { cardId, type CardId } from '../sim/ids.ts';
import { deckSizeAtLevel, MAX_LEVEL, STARTING_DECK_SIZE } from '../sim/level.ts';
import { parseCardCatalogue, type ParseResult } from './cards.ts';
import skillData from './skills.json' with { type: 'json' };

/**
 * GDD §5.1's class skill table.
 *
 * > Fixed authored skill table. Level *N* grants skill *N*, always, in order.
 * > **There is no card selection screen anywhere in the game.**
 *
 * The order in the JSON *is* the progression, which is why this module reads it
 * as a list rather than a set: the first five are level 1's four starters and
 * its signature, and the sixteenth is level 12's capstone.
 *
 * Reuses `parseCardCatalogue` rather than validating a second card shape — a
 * skill is a card, and two parsers for one shape is two places for them to
 * disagree (CLAUDE.md §5.5).
 */

export interface SkillTable {
  readonly catalogue: CardCatalogue;
  /** In grant order (GDD §5.1). Index 0 is granted at level 1. */
  readonly order: readonly CardId[];
  /** The card §6.1 opens the run with a socket on. */
  readonly signature: CardId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseSkillTable(input: unknown): ParseResult<SkillTable> {
  if (!isRecord(input) || !Array.isArray(input.skills)) {
    return { ok: false, errors: ['skill data has no "skills" array'] };
  }

  // The table's length is the level cap's promise: sixteen skills for twelve
  // levels, five of them granted at the first (GDD §5.1). A table of the wrong
  // length would leave a level with nothing to hand over.
  const expected = deckSizeAtLevel(MAX_LEVEL);
  if (input.skills.length !== expected) {
    return {
      ok: false,
      errors: [
        `skill table has ${String(input.skills.length)} skills, expected ${String(expected)}`,
      ],
    };
  }

  const parsed = parseCardCatalogue({ cards: input.skills });
  if (!parsed.ok) return parsed;

  const order: CardId[] = [];
  for (const entry of input.skills) {
    if (!isRecord(entry) || typeof entry.id !== 'string') {
      return { ok: false, errors: ['a skill has no id'] };
    }
    order.push(cardId(entry.id));
  }

  const signature = input.signature;
  if (typeof signature !== 'string' || parsed.value[signature] === undefined) {
    return { ok: false, errors: [`the signature names no skill: ${JSON.stringify(signature)}`] };
  }

  // §6.1 opens the run with a socket on the signature, so it has to be a card
  // the player actually holds at level 1 rather than one they earn later.
  const at = order.indexOf(cardId(signature));
  if (at >= STARTING_DECK_SIZE) {
    return {
      ok: false,
      errors: [
        `the signature "${signature}" is granted at level ${String(at - STARTING_DECK_SIZE + 2)}, not level 1`,
      ],
    };
  }

  return { ok: true, value: { catalogue: parsed.value, order, signature: cardId(signature) } };
}

/** The skill table, validated. Throws loudly rather than booting with bad data. */
export function skillTable(): SkillTable {
  const parsed = parseSkillTable(skillData);
  if (!parsed.ok) throw new Error(`skills.json is invalid:\n- ${parsed.errors.join('\n- ')}`);
  return parsed.value;
}

/**
 * The deck at a level (GDD §5.1). Not a choice and not a shuffle — the first
 * *n* skills in the authored order, where *n* is what the table says the level
 * holds. P2: the deck is given; the build is earned.
 */
export function deckAtLevel(table: SkillTable, level: number): readonly CardId[] {
  return table.order.slice(0, deckSizeAtLevel(level));
}

/** What levelling to this level just handed over, or null for level 1. */
export function skillGrantedAt(table: SkillTable, level: number): CardDefinition | null {
  if (level <= 1) return null;
  const id = table.order[deckSizeAtLevel(level) - 1];
  return id === undefined ? null : (table.catalogue[id] ?? null);
}
