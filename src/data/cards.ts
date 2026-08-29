import type { CardCatalogue, CardDefinition } from '../sim/card.ts';
import { cardId } from '../sim/ids.ts';
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
  readonly tags: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function readCard(value: unknown, position: number): RawCard | string {
  if (!isRecord(value)) return `card ${String(position)} is not an object`;

  const { id, name, class: weightClass, damage, tags } = value;
  if (typeof id !== 'string' || id.length === 0) return `card ${String(position)} has no id`;
  if (typeof name !== 'string' || name.length === 0) return `card "${id}" has no name`;
  if (!isWeightClass(weightClass))
    return `card "${id}" has an unknown Weight class: ${String(weightClass)}`;
  if (typeof damage !== 'number' || !Number.isFinite(damage) || damage < 0) {
    return `card "${id}" has invalid damage: ${String(damage)}`;
  }
  if (!isStringArray(tags)) return `card "${id}" has invalid tags`;

  return { id, name, class: weightClass, damage, tags };
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

/** The M0 deck, validated. Throws loudly rather than booting with bad data. */
export function m0Catalogue(): CardCatalogue {
  const parsed = parseCardCatalogue(cardData);
  if (!parsed.ok) throw new Error(`cards.m0.json is invalid:\n- ${parsed.errors.join('\n- ')}`);
  return parsed.value;
}
