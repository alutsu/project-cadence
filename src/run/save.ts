import type { ParseResult } from '../data/cards.ts';
import { SKILLS } from './RunState.ts';
import type { RunState } from './RunState.ts';
import {
  GEM_TIERS,
  isFrame,
  isGemTier,
  type BuildState,
  type CardSockets,
  type Gem,
  type GemEffect,
} from '../sim/gem.ts';
import { isRegisteredEffect } from '../sim/gemEffects.ts';
import type { Materials } from './materials.ts';
import { cardId, gemId, nodeId } from '../sim/ids.ts';
import { createRng } from '../sim/rng.ts';
import { digestOf, generateMap, type RunPosition } from './map.ts';
import type { RngState, RngStreamName } from '../sim/rng.ts';
import { ULTIMATE_RULES, type CombatRules } from '../sim/rules.ts';
import { isTag, TAGS, type Tag } from '../sim/tag.ts';
import { tick } from '../sim/tick.ts';
import type { Attunement } from '../sim/weave.ts';

/**
 * Serializing a run (GDD §16).
 *
 * > Serialize full run state + all PRNG stream positions to IndexedDB after
 * > every node transition and every encounter end. Never mid-encounter — an
 * > encounter is atomic; resume replays it from its start state.
 *
 * **Pure and synchronous.** IndexedDB is asynchronous and browser-only, and it
 * lives in `/src/platform` behind an adapter; this module only turns a run into
 * plain data and back. That split is what lets the whole thing be tested
 * without a browser, and it is enforced by an architecture guard rather than by
 * remembering.
 *
 * What is deliberately *not* written: the card catalogue and the gem effect
 * definitions are content, rebuilt from `/data`, and writing them would freeze a
 * copy of the game's balance into every save. `CombatState` is not written at
 * all — §16 says an encounter is atomic, so the run resumes at the boundary
 * before it and replays it.
 */

export const CURRENT_SAVE_VERSION = 1;

/**
 * No optional properties anywhere below, only nulls.
 *
 * `exactOptionalPropertyTypes` plus a JSON round trip makes "absent" and
 * "present but undefined" two different values on the way back, and a save that
 * changes shape by round-tripping is a save that cannot be trusted. The
 * round-trip test is what enforces this, not review.
 */
export interface SaveV1 {
  readonly seed: number;
  /** §16: the map is regenerated from the seed; this refuses a changed one. */
  readonly mapDigest: number;
  readonly position: RunPosition;
  readonly level: number;
  readonly xp: number;
  readonly threat: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly baselineMaxHp: number;
  readonly gold: number;
  readonly insight: number;
  readonly crafted: number;
  readonly materials: Readonly<Record<string, number>>;
  readonly attunement: Readonly<Record<string, string>>;
  readonly saturation: readonly (string | null)[];
  readonly deck: readonly string[];
  readonly pouch: readonly string[];
  readonly gems: readonly SavedGem[];
  readonly sockets: readonly SavedSockets[];
  readonly rules: CombatRules;
  readonly streams: Readonly<Record<string, RngState>>;
}

export interface SavedGem {
  readonly id: string;
  readonly frame: string;
  readonly tier: number;
  readonly words: readonly string[];
  readonly weightDelta: number;
  readonly effects: readonly SavedEffect[];
  readonly affixes: readonly SavedEffect[];
}

export interface SavedEffect {
  readonly type: string;
  readonly value: number;
  readonly tag: string | null;
}

export interface SavedSockets {
  readonly card: string;
  readonly opened: number;
  readonly gems: readonly string[];
  readonly scarred: boolean;
}

export interface SaveEnvelope {
  readonly version: number;
  /**
   * Supplied by `/platform`, which is the only layer allowed to read a clock.
   * Nothing in `/run` ever reads it back — it exists so a human can tell two
   * saves apart, not so the game can.
   */
  readonly savedAtMs: number;
  readonly run: SaveV1;
}

/** Per-fight gem counters are never written: a charge is earned in the fight
 * it is spent in (GDD §6.2), and an encounter resumes from its start anyway. */
export function toSnapshot(run: RunState): SaveV1 {
  return {
    seed: run.seed,
    mapDigest: digestOf(run.map),
    position: run.position,
    level: run.level,
    xp: run.xp,
    threat: run.threat,
    hp: run.hp,
    maxHp: run.maxHp,
    baselineMaxHp: run.baselineMaxHp,
    gold: 0,
    insight: run.insight,
    crafted: run.crafted,
    materials: { ...run.materials },
    attunement: { ...run.attunement },
    saturation: [...run.saturation.recent],
    deck: [...run.deck],
    pouch: [...run.pouch],
    gems: Object.values(run.build.gems).map(savedGem),
    sockets: Object.entries(run.build.sockets).map(([card, sockets]) => ({
      card,
      opened: sockets.opened,
      gems: [...sockets.gems],
      scarred: sockets.scarred,
    })),
    rules: run.rules,
    streams: { ...run.streams },
  };
}

function savedGem(gem: Gem): SavedGem {
  return {
    id: gem.id,
    frame: gem.frame,
    tier: gem.tier,
    words: [...gem.words],
    weightDelta: gem.weightDelta,
    effects: gem.effects.map(savedEffect),
    affixes: gem.affixes.map(savedEffect),
  };
}

function savedEffect(effect: Gem['effects'][number]): SavedEffect {
  return { type: effect.type, value: effect.value, tag: effect.tag };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readNumber(value: unknown, field: string): number | string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return `"${field}" is not a finite number`;
  }
  return value;
}

function readStrings(value: unknown, field: string): readonly string[] | string {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    return `"${field}" is not a list of strings`;
  }
  return value;
}

const ATTUNEMENTS: readonly string[] = ['ascendant', 'neutral', 'suppressed'];

/**
 * Parses straight into the domain type rather than into the wire shape. The
 * narrowing `isTag` already did is exactly what a cast back to `Tag` would be
 * asserting, so returning `GemEffect` here means never writing the cast
 * (CLAUDE.md §3.1).
 */
function readEffect(value: unknown, where: string): GemEffect | string {
  if (!isRecord(value)) return `${where} is not an object`;
  if (typeof value.type !== 'string' || value.type.length === 0) return `${where} has no type`;

  const rolled = readNumber(value.value, `${where}.value`);
  if (typeof rolled === 'string') return rolled;

  const named: unknown = value.tag ?? null;
  if (named !== null && !isTag(named)) return `${where} names an unknown tag`;

  return { type: value.type, value: rolled, tag: named };
}

function readEffects(value: unknown, where: string): readonly GemEffect[] | string {
  if (!Array.isArray(value)) return `${where} is not a list`;

  const read = value.map((entry, at) => readEffect(entry, `${where}[${String(at)}]`));
  const failure = read.find((entry): entry is string => typeof entry === 'string');
  return failure ?? read.filter((entry): entry is GemEffect => typeof entry !== 'string');
}

function readGem(value: unknown, at: number): Gem | string {
  const where = `gem ${String(at)}`;
  if (!isRecord(value)) return `${where} is not an object`;
  if (typeof value.id !== 'string' || value.id.length === 0) return `${where} has no id`;
  // The frame and tier are closed sets; a save naming one that no longer exists
  // is a save from a different game and must be refused rather than coerced.
  if (!isFrame(value.frame)) return `${where} has an unknown frame`;
  if (!isGemTier(value.tier)) return `${where} has an invalid tier`;

  const weightDelta = readNumber(value.weightDelta, `${where}.weightDelta`);
  if (typeof weightDelta === 'string') return weightDelta;
  const words = readStrings(value.words ?? [], `${where}.words`);
  if (typeof words === 'string') return words;
  const effects = readEffects(value.effects, `${where}.effects`);
  if (typeof effects === 'string') return effects;
  const affixes = readEffects(value.affixes ?? [], `${where}.affixes`);
  if (typeof affixes === 'string') return affixes;

  return {
    id: gemId(value.id),
    frame: value.frame,
    tier: value.tier,
    words,
    weightDelta,
    effects,
    affixes,
  };
}

const STREAM_NAMES: readonly RngStreamName[] = ['map', 'gemRoll', 'enemyGen', 'combat', 'weave'];

function readStreams(value: unknown): Readonly<Record<RngStreamName, RngState>> | string {
  if (!isRecord(value)) return '"streams" is not an object';

  const streams: Partial<Record<RngStreamName, RngState>> = {};
  for (const name of STREAM_NAMES) {
    const entry: unknown = value[name];
    if (!isRecord(entry)) return `"streams.${name}" is missing`;
    const seed = readNumber(entry.seed, `streams.${name}.seed`);
    const position = readNumber(entry.position, `streams.${name}.position`);
    if (typeof seed === 'string') return seed;
    if (typeof position === 'string') return position;
    if (!Number.isInteger(position) || position < 0) return `"streams.${name}" has a bad position`;
    streams[name] = { stream: name, seed, position };
  }

  // A save from a build with a different stream list is a save from a different
  // game — the positions would line up by name and mean something else.
  const known: readonly string[] = STREAM_NAMES;
  const extra = Object.keys(value).filter((name) => !known.includes(name));
  if (extra.length > 0) return `"streams" has unknown streams: ${extra.join(', ')}`;

  return {
    map: streams.map ?? never('map'),
    gemRoll: streams.gemRoll ?? never('gemRoll'),
    enemyGen: streams.enemyGen ?? never('enemyGen'),
    combat: streams.combat ?? never('combat'),
    weave: streams.weave ?? never('weave'),
  };
}

function never(name: string): never {
  throw new Error(`unreachable: stream "${name}" passed validation but is absent`);
}

function readRules(value: unknown): CombatRules | string {
  if (!isRecord(value)) return '"rules" is not an object';
  const named: unknown = value.ultimate;
  // Found by identity in the published list, so the result is the union member
  // itself rather than a string that has been checked against it.
  const ultimate = ULTIMATE_RULES.find((rule) => rule === named);
  if (ultimate === undefined) return '"rules.ultimate" names an unknown rule';

  const numbers = ['guardCap', 'guardDecayPerTick', 'waitWeight', 'waitGuard', 'firstStagger'];
  for (const field of numbers) {
    const read = readNumber(value[field], `rules.${field}`);
    if (typeof read === 'string') return read;
  }

  return {
    ultimate,
    guardCap: Number(value.guardCap),
    guardDecayPerTick: Number(value.guardDecayPerTick),
    waitWeight: tick(Number(value.waitWeight)),
    waitGuard: Number(value.waitGuard),
    firstStagger: Number(value.firstStagger),
  };
}

function readAttunement(value: unknown): Readonly<Record<Tag, Attunement>> | string {
  if (!isRecord(value)) return '"attunement" is not an object';

  const table: Partial<Record<Tag, Attunement>> = {};
  for (const tag of TAGS) {
    const standing: unknown = value[tag];
    if (typeof standing !== 'string' || !ATTUNEMENTS.includes(standing)) {
      return `"attunement.${tag}" names an unknown standing`;
    }
    table[tag] =
      standing === 'ascendant' ? 'ascendant' : standing === 'suppressed' ? 'suppressed' : 'neutral';
  }

  return {
    Physical: table.Physical ?? 'neutral',
    Fire: table.Fire ?? 'neutral',
    Frost: table.Frost ?? 'neutral',
    Arcane: table.Arcane ?? 'neutral',
    Shadow: table.Shadow ?? 'neutral',
    Storm: table.Storm ?? 'neutral',
  };
}

/**
 * A stored save, back into a run — or a stated reason it cannot be.
 *
 * Never a partial load (GDD §16). Every id is checked against the content that
 * exists *now*: a deck naming a card this build no longer has, or a gem naming
 * an effect atom that was renamed, is a save from a different game. Refusing it
 * loudly is the only honest option, because half-loading it would produce a run
 * that plays subtly differently from the one that was saved.
 */
export function fromSnapshot(raw: unknown): ParseResult<RunState> {
  if (!isRecord(raw)) return { ok: false, errors: ['the save is not an object'] };

  const numbers = [
    'seed',
    'level',
    'xp',
    'threat',
    'hp',
    'maxHp',
    'baselineMaxHp',
    'insight',
    'crafted',
  ];
  const errors: string[] = [];
  for (const field of numbers) {
    const read = readNumber(raw[field], field);
    if (typeof read === 'string') errors.push(read);
  }
  if (errors.length > 0) return { ok: false, errors };

  // §16, D40: the map is derived, so it is regenerated rather than read — and
  // the stored digest is what refuses a save laid out by a different generator
  // instead of silently resuming into a different world.
  const map = generateMap(createRng(Number(raw.seed), 'map'));
  if (raw.mapDigest !== digestOf(map)) {
    return { ok: false, errors: ['the save was laid out by a different map generator'] };
  }

  const position = readPosition(raw.position);
  if (typeof position === 'string') return { ok: false, errors: [position] };

  const streams = readStreams(raw.streams);
  if (typeof streams === 'string') return { ok: false, errors: [streams] };
  const rules = readRules(raw.rules);
  if (typeof rules === 'string') return { ok: false, errors: [rules] };
  const attunement = readAttunement(raw.attunement);
  if (typeof attunement === 'string') return { ok: false, errors: [attunement] };

  const deck = readStrings(raw.deck, 'deck');
  if (typeof deck === 'string') return { ok: false, errors: [deck] };
  const unknownCards = deck.filter((card) => SKILLS.catalogue[card] === undefined);
  if (unknownCards.length > 0) {
    return {
      ok: false,
      errors: [`the deck names cards this build does not have: ${unknownCards.join(', ')}`],
    };
  }

  const pouch = readStrings(raw.pouch, 'pouch');
  if (typeof pouch === 'string') return { ok: false, errors: [pouch] };

  const build = readBuild(raw);
  if (typeof build === 'string') return { ok: false, errors: [build] };

  const materials = readMaterials(raw.materials);
  if (typeof materials === 'string') return { ok: false, errors: [materials] };

  const recent = readSaturation(raw.saturation);
  if (typeof recent === 'string') return { ok: false, errors: [recent] };

  return {
    ok: true,
    value: {
      seed: Number(raw.seed),
      map,
      position,
      level: Number(raw.level),
      xp: Number(raw.xp),
      threat: Number(raw.threat),
      hp: Number(raw.hp),
      maxHp: Number(raw.maxHp),
      baselineMaxHp: Number(raw.baselineMaxHp),
      attunement,
      saturation: { recent },
      build,
      deck: deck.map(cardId),
      materials,
      insight: Number(raw.insight),
      pouch: pouch.map(gemId),
      crafted: Number(raw.crafted),
      rules,
      streams,
    },
  };
}

/**
 * §7.3's window: which tag carried each of the last six encounters, or null for
 * one no tag dominated. Narrowed element by element, because `Array.isArray`
 * narrows to `any[]` and reading straight from that would smuggle `any` in.
 */
function readSaturation(value: unknown): readonly (Tag | null)[] | string {
  if (!isUnknownArray(value)) return '"saturation" is not a list';

  const recent: (Tag | null)[] = [];
  for (const entry of value) {
    if (entry === null || entry === undefined) recent.push(null);
    else if (isTag(entry)) recent.push(entry);
    else return '"saturation" holds something that is not a tag';
  }
  return recent;
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function readPosition(value: unknown): RunPosition | string {
  if (!isRecord(value)) return '"position" is not an object';

  const depth = readNumber(value.depth, 'position.depth');
  const indexInNode = readNumber(value.indexInNode, 'position.indexInNode');
  if (typeof depth === 'string') return depth;
  if (typeof indexInNode === 'string') return indexInNode;

  const taken = readStrings(value.taken ?? [], 'position.taken');
  if (typeof taken === 'string') return taken;

  const node: unknown = value.node ?? null;
  if (node !== null && typeof node !== 'string') return '"position.node" is not a node';

  return {
    depth,
    taken: taken.map(nodeId),
    node: node === null ? null : nodeId(node),
    indexInNode,
    dead: value.dead === true,
  };
}

function readMaterials(value: unknown): Materials | string {
  if (!isRecord(value)) return '"materials" is not an object';

  const held: Record<number, number> = {};
  for (const tier of GEM_TIERS) {
    const count = readNumber(value[String(tier)], `materials.${String(tier)}`);
    if (typeof count === 'string') return count;
    held[tier] = count;
  }
  return { 1: held[1] ?? 0, 2: held[2] ?? 0, 3: held[3] ?? 0, 4: held[4] ?? 0 };
}

function readBuild(raw: Record<string, unknown>): BuildState | string {
  if (!Array.isArray(raw.gems)) return '"gems" is not a list';
  if (!Array.isArray(raw.sockets)) return '"sockets" is not a list';

  const read = raw.gems.map((entry, at) => readGem(entry, at));
  const failure = read.find((entry): entry is string => typeof entry === 'string');
  if (failure !== undefined) return failure;

  const gems: Record<string, Gem> = {};
  for (const gem of read.filter((entry): entry is Gem => typeof entry !== 'string')) {
    // Running the real handlers proves the atoms this gem names still exist and
    // still take the parameters it stored — the same check the gem parser makes
    // at load, for the same reason (CLAUDE.md §3.3).
    if (!gem.effects.every((effect) => isRegisteredEffect(effect.type))) {
      return `gem "${gem.id}" names an effect this build no longer has`;
    }
    gems[gem.id] = gem;
  }

  const sockets: Record<string, CardSockets> = {};
  for (const entry of raw.sockets) {
    if (!isRecord(entry) || typeof entry.card !== 'string') return 'a socket entry has no card';
    const seated = readStrings(entry.gems ?? [], `sockets.${entry.card}.gems`);
    if (typeof seated === 'string') return seated;
    const opened = readNumber(entry.opened, `sockets.${entry.card}.opened`);
    if (typeof opened === 'string') return opened;

    sockets[entry.card] = {
      opened,
      gems: seated.map(gemId),
      scarred: entry.scarred === true,
    };
  }

  // Runtime is per-fight and never written (GDD §6.2). It comes back *empty*
  // rather than zeroed-per-gem, because that is what a run holds between
  // encounters — `startCombat` is what populates it, and a resumed run must be
  // structurally identical to one that never stopped, not merely equivalent.
  return { gems, sockets, runtime: {} };
}

/**
 * GDD §16: "Save format is versioned. Migration or invalidation on schema
 * change, decided **before the first public build**."
 *
 * The chain is empty today and deliberately still exercised by a test, because
 * a migration path retrofitted after saves exist in the wild is a different and
 * much worse problem. An unknown version is refused rather than guessed at.
 */
export type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

export const MIGRATIONS: Readonly<Record<number, Migration>> = {};

export function migrate(envelope: unknown): ParseResult<Record<string, unknown>> {
  if (!isRecord(envelope)) return { ok: false, errors: ['the save is not an object'] };

  const version = envelope.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
    return { ok: false, errors: ['the save states no version'] };
  }
  if (version > CURRENT_SAVE_VERSION) {
    return {
      ok: false,
      errors: [`the save is from a newer build (version ${String(version)})`],
    };
  }
  if (!isRecord(envelope.run)) return { ok: false, errors: ['the save holds no run'] };

  let raw: Record<string, unknown> = envelope.run;
  for (let from = version; from < CURRENT_SAVE_VERSION; from += 1) {
    const step = MIGRATIONS[from];
    if (step === undefined) {
      return { ok: false, errors: [`no migration from version ${String(from)}`] };
    }
    raw = step(raw);
  }

  // Handed on unvalidated on purpose: this function's job is the version chain,
  // and `fromSnapshot` is the field check. Splitting them means a malformed save
  // is *reported* rather than thrown, which is what §16's "invalidation" means.
  return { ok: true, value: raw };
}
