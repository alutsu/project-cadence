import relicData from './relics.json' with { type: 'json' };
import type { ParseResult } from './cards.ts';
import { isRegisteredRelicAtom, type RelicAtom } from '../sim/relicEffects.ts';
import { ATTUNEMENTS, type Attunement } from '../sim/weave.ts';

/**
 * Relics (GDD §10), validated on load.
 *
 * §10's closing line is the rule this parser enforces: *"Every relic should
 * carry a real drawback. Pure upgrades create a known-correct relic ranking,
 * which is exactly the meta this design exists to avoid."* A relic without a
 * drawback fails at load, in the same shape `frames.json` already refuses one —
 * because the failure this guards against is not a crash, it is a relic that
 * quietly becomes the correct pick.
 */

export type RelicCategory = 'Timeline' | 'Economy' | 'Weave' | 'Socket' | 'Deck' | 'Risk';

const CATEGORIES: readonly RelicCategory[] = [
  'Timeline',
  'Economy',
  'Weave',
  'Socket',
  'Deck',
  'Risk',
];

export interface RelicDefinition {
  readonly id: string;
  readonly name: string;
  readonly category: RelicCategory;
  /** What it gives, in the player's words — §10's own phrasing where it has one. */
  readonly gain: string;
  /** What it costs. Never empty; the parser refuses that. */
  readonly drawback: string;
  readonly atoms: readonly RelicAtom[];
}

export type RelicTable = Readonly<Record<string, RelicDefinition>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCategory(value: unknown): value is RelicCategory {
  return CATEGORIES.some((category) => category === value);
}

function isAttunement(value: unknown): value is Attunement {
  return ATTUNEMENTS.some((slot) => slot === value);
}

function readAtom(entry: unknown, relic: string): RelicAtom | string {
  if (!isRecord(entry)) return `relic "${relic}" has an atom that is not an object`;

  const { type, value, slot } = entry;
  if (typeof type !== 'string' || type.length === 0) return `relic "${relic}" has a nameless atom`;
  // An unregistered atom is a relic asking for a lever nobody built. It fails
  // here, naming itself, rather than silently doing nothing in a fight.
  if (!isRegisteredRelicAtom(type)) return `relic "${relic}" names unknown atom "${type}"`;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return `relic "${relic}" atom "${type}" has no finite value`;
  }
  if (slot !== undefined && !isAttunement(slot)) {
    return `relic "${relic}" atom "${type}" names a slot that is not an Attunement`;
  }

  return { type, value, slot: isAttunement(slot) ? slot : null };
}

function readRelic(entry: unknown, position: number): RelicDefinition | string {
  if (!isRecord(entry)) return `relic at position ${String(position)} is not an object`;

  const { id, name, category, gain, drawback, atoms } = entry;
  if (typeof id !== 'string' || id.length === 0) {
    return `relic at position ${String(position)} has no id`;
  }
  if (typeof name !== 'string' || name.length === 0) return `relic "${id}" has no name`;
  if (!isCategory(category)) return `relic "${id}" has no known category`;
  if (typeof gain !== 'string' || gain.length === 0) return `relic "${id}" states no gain`;
  // GDD §10. This is the rule, not a formality.
  if (typeof drawback !== 'string' || drawback.length === 0) {
    return `relic "${id}" states no drawback`;
  }
  if (!Array.isArray(atoms) || atoms.length === 0) return `relic "${id}" does nothing`;

  const read = atoms.map((atom) => readAtom(atom, id));
  const failure = read.find((atom): atom is string => typeof atom === 'string');
  if (failure !== undefined) return failure;

  return {
    id,
    name,
    category,
    gain,
    drawback,
    atoms: read.filter((atom): atom is RelicAtom => typeof atom !== 'string'),
  };
}

export function parseRelicTable(input: unknown): ParseResult<RelicTable> {
  if (!isRecord(input) || !Array.isArray(input.relics)) {
    return { ok: false, errors: ['relic data has no "relics" array'] };
  }

  const read = input.relics.map((entry, position) => readRelic(entry, position));
  const errors = read.filter((entry): entry is string => typeof entry === 'string');
  if (errors.length > 0) return { ok: false, errors };

  const relics = read.filter((entry): entry is RelicDefinition => typeof entry !== 'string');
  const duplicates = relics
    .map((relic) => relic.id)
    .filter((id, at, all) => all.indexOf(id) !== at);
  if (duplicates.length > 0) {
    return { ok: false, errors: [`duplicate relics: ${duplicates.join(', ')}`] };
  }

  const table: Record<string, RelicDefinition> = {};
  for (const relic of relics) table[relic.id] = relic;
  return { ok: true, value: table };
}

/** The relic table, validated. Throws loudly rather than booting with bad data. */
export function relicTable(): RelicTable {
  const parsed = parseRelicTable(relicData);
  if (!parsed.ok) throw new Error(`relics.json is invalid:\n- ${parsed.errors.join('\n- ')}`);
  return parsed.value;
}

export function relicIds(): readonly string[] {
  return Object.keys(relicTable());
}
