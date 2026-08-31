import type { CardCatalogue, CardDefinition, CardTargeting } from '../sim/card.ts';
import { cardId, type CardId } from '../sim/ids.ts';
import { WEIGHT_CLASSES, isWeightClass } from '../sim/weightClass.ts';
import cardData from './cards.m0.json' with { type: 'json' };

/**
 * Boundary data is validated on load (CLAUDE.md §3.3). A cache read is not a
 * promise that the JSON matches its interface, and an invalid card must fail at
 * load rather than midway through an encounter.
 */
export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly string[] };

interface RawCard {
  readonly id: string;
  readonly name: string;
  readonly class: string;
  readonly damage: number;
  readonly targeting: CardTargeting;
  readonly tags: readonly string[];
}

function isTargeting(value: unknown): value is CardTargeting {
  return value === 'single' || value === 'all';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function readCard(value: unknown, position: number): RawCard | string {
  if (!isRecord(value)) return `card ${String(position)} is not an object`;

  const { id, name, class: weightClass, damage, targeting, tags } = value;
  if (typeof id !== 'string' || id.length === 0) return `card ${String(position)} has no id`;
  if (typeof name !== 'string' || name.length === 0) return `card "${id}" has no name`;
  if (!isWeightClass(weightClass))
    return `card "${id}" has an unknown Weight class: ${String(weightClass)}`;
  if (typeof damage !== 'number' || !Number.isFinite(damage) || damage < 0) {
    return `card "${id}" has invalid damage: ${String(damage)}`;
  }
  if (!isStringArray(tags)) return `card "${id}" has invalid tags`;

  // Most cards hit one enemy, so the field is written only on the ones that do
  // not (GDD §4.8). Absent means single; a typo'd "aoe" must still fail loudly
  // rather than quietly load as a single-target card (CLAUDE.md §3.3).
  const reach: unknown = targeting ?? 'single';
  if (!isTargeting(reach)) {
    return `card "${id}" has an unknown targeting: ${JSON.stringify(targeting)}`;
  }

  return { id, name, class: weightClass, damage, targeting: reach, tags };
}

function toDefinition(raw: RawCard): CardDefinition {
  if (!isWeightClass(raw.class))
    throw new Error(`unreachable: unvalidated Weight class ${raw.class}`);
  const profile = WEIGHT_CLASSES[raw.class];
  return {
    id: cardId(raw.id),
    name: raw.name,
    weightClass: raw.class,
    weight: profile.weight,
    recovery: profile.recovery,
    damage: raw.damage,
    targeting: raw.targeting,
    tags: raw.tags,
  };
}

export function parseCardCatalogue(input: unknown): ParseResult<CardCatalogue> {
  if (!isRecord(input) || !Array.isArray(input.cards)) {
    return { ok: false, errors: ['card data has no "cards" array'] };
  }

  const read = input.cards.map((entry, position) => readCard(entry, position));
  const errors = read.filter((entry): entry is string => typeof entry === 'string');
  if (errors.length > 0) return { ok: false, errors };

  const cards = read.filter((entry): entry is RawCard => typeof entry !== 'string');
  const duplicates = cards.map((card) => card.id).filter((id, at, all) => all.indexOf(id) !== at);
  if (duplicates.length > 0)
    return { ok: false, errors: [`duplicate card ids: ${duplicates.join(', ')}`] };

  const catalogue: Record<string, CardDefinition> = {};
  for (const card of cards) catalogue[card.id] = toDefinition(card);
  return { ok: true, value: catalogue };
}

/**
 * The list the player actually holds, in authored order before the shuffle.
 *
 * Separate from the catalogue because they answer different questions: the
 * catalogue is which cards *exist*, the deck is which ones you were *given*
 * (P2). Repeats are the point — M0 has only Weight class, damage and reach to
 * tell cards apart, so a twelve-distinct deck could only be twelve cards where
 * nine are never the right play. Twelve cards drawn from seven says the same
 * thing honestly.
 */
export function parseDeck(
  input: unknown,
  catalogue: CardCatalogue,
): ParseResult<readonly CardId[]> {
  if (!isRecord(input) || !Array.isArray(input.deck)) {
    return { ok: false, errors: ['card data has no "deck" array'] };
  }

  const errors: string[] = [];
  const deck: CardId[] = [];
  for (const [position, entry] of input.deck.entries()) {
    if (typeof entry !== 'string' || catalogue[entry] === undefined) {
      errors.push(`deck slot ${String(position)} names no card: ${JSON.stringify(entry)}`);
      continue;
    }
    deck.push(cardId(entry));
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: deck };
}

/** The M0 catalogue, validated. Throws loudly rather than booting with bad data. */
export function m0Catalogue(): CardCatalogue {
  const parsed = parseCardCatalogue(cardData);
  if (!parsed.ok) throw new Error(`cards.m0.json is invalid:\n- ${parsed.errors.join('\n- ')}`);
  return parsed.value;
}

/** The M0 deck, validated against the catalogue it draws from. */
export function m0Deck(catalogue: CardCatalogue = m0Catalogue()): readonly CardId[] {
  const parsed = parseDeck(cardData, catalogue);
  if (!parsed.ok)
    throw new Error(`cards.m0.json deck is invalid:\n- ${parsed.errors.join('\n- ')}`);
  return parsed.value;
}
