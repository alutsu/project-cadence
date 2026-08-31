import { CHAIN_SIZE, ENCOUNTERS, PLAYER, PLAYER_MAX_HP, startsChain } from '../data/encounters.ts';
import { m0Catalogue, m0Deck } from '../data/cards.ts';
import type { CombatSetup } from '../sim/combat.ts';
import type { CombatEvent } from '../sim/events.ts';
import { type BuildState, type Frame, type GemTier } from '../sim/gem.ts';
import { cardId, type CardId, type GemId } from '../sim/ids.ts';
import { createRng, restoreRng, type Rng, type RngState, type RngStreamName } from '../sim/rng.ts';
import { DEFAULT_RULES, type CombatRules } from '../sim/rules.ts';
import {
  attributeDamage,
  dominantTag,
  NO_HISTORY,
  recordEncounter,
  saturationOf,
  type SaturationHistory,
} from '../sim/saturation.ts';
import type { CombatOutcome } from '../sim/state.ts';
import type { WeaveSnapshot } from '../sim/weave.ts';
import { rollAttunement, shiftAttunement, type AttunementTable } from './attunement.ts';
import { grantMaterial, NO_MATERIALS, spendMaterial, type Materials } from './materials.ts';
import { craftGem, REROLL_INSIGHT_COST, rerollValues } from './forge.ts';
import { attemptSocket, removeGem, seatGem, socketsOf } from './socket.ts';

/**
 * Everything that outlives a single fight (GDD §5, §7, §9).
 *
 * M0 kept this on private fields of a Phaser scene, which made a Scene the
 * owner of game state — the one thing CLAUDE.md §4.1 says a Scene must never
 * be. Sockets, Attunement and Saturation are all run-scoped by definition, so
 * the run layer stops being optional at M1 even though the *map* is still M2's.
 *
 * `/sim` may not import this (enforced by tests/architecture). The direction is
 * one-way on purpose: a run **produces** a `CombatSetup`, and the reducer never
 * reaches back out for anything.
 */

/**
 * [M1 STAND-IN] M0's encounter chain is the placeholder for §11's map: six
 * encounters in three chains of two, with a restore between them. A chain is
 * treated as a Depth, which gives §7.1's shift schedule exactly the two shifts
 * it asks for — at the start of chains 2 and 3 (docs/M1_PLAN.md D21).
 */
export const DEPTHS = Math.ceil(ENCOUNTERS.length / CHAIN_SIZE);

/** GDD §6.1: Max HP may never fall below 40% of the level baseline. */
export const MAX_HP_FLOOR_SHARE = 0.4;

export interface RunState {
  readonly seed: number;
  readonly encounterIndex: number;
  readonly hp: number;
  readonly maxHp: number;
  /**
   * What Max HP would be with no sockets bought (GDD §6.1's "level baseline").
   * [M1 STAND-IN] — this becomes the level table's value when §5.1 lands in M2.
   */
  readonly baselineMaxHp: number;
  readonly attunement: AttunementTable;
  readonly saturation: SaturationHistory;
  readonly build: BuildState;
  readonly deck: readonly CardId[];
  /** GDD §9's ladder, by tier. Rarity is what sets a gem's Tier (§6.2). */
  readonly materials: Materials;
  readonly insight: number;
  /** Gems crafted but not yet seated. Socketing is permanent (§6.2). */
  readonly pouch: readonly GemId[];
  /** Distinguishes one crafted gem from the next, and survives a save. */
  readonly crafted: number;
  readonly rules: CombatRules;
  /** GDD §16, §20.2: stream positions are part of the save and the summary. */
  readonly streams: Readonly<Record<RngStreamName, RngState>>;
}

const STREAM_NAMES: readonly RngStreamName[] = ['map', 'gemRoll', 'enemyGen', 'combat', 'weave'];

function freshStreams(seed: number): Readonly<Record<RngStreamName, RngState>> {
  const streams: Partial<Record<RngStreamName, RngState>> = {};
  for (const name of STREAM_NAMES) streams[name] = createRng(seed, name).state();
  return {
    map: streams.map ?? createRng(seed, 'map').state(),
    gemRoll: streams.gemRoll ?? createRng(seed, 'gemRoll').state(),
    enemyGen: streams.enemyGen ?? createRng(seed, 'enemyGen').state(),
    combat: streams.combat ?? createRng(seed, 'combat').state(),
    weave: streams.weave ?? createRng(seed, 'weave').state(),
  };
}

/** Resumes one stream where it left off, and hands back its new position. */
function draw<T>(
  run: RunState,
  name: RngStreamName,
  take: (rng: Rng) => T,
): { readonly value: T; readonly streams: RunState['streams'] } {
  const rng = restoreRng(run.streams[name]);
  const value = take(rng);
  return { value, streams: { ...run.streams, [name]: rng.state() } };
}

export function startRun(seed: number): RunState {
  // The Attunement is rolled before the run exists rather than patched into it
  // afterwards: it is visible from the first screen (GDD §7.1), so there is no
  // moment in a run's life when it does not have one.
  const weave = createRng(seed, 'weave');
  const attunement = rollAttunement(weave);

  return {
    seed,
    encounterIndex: 0,
    hp: PLAYER_MAX_HP,
    maxHp: PLAYER_MAX_HP,
    baselineMaxHp: PLAYER_MAX_HP,
    attunement,
    saturation: NO_HISTORY,
    build: OPENING_BUILD,
    deck: m0Deck(),
    materials: NO_MATERIALS,
    insight: 0,
    pouch: [],
    crafted: 0,
    rules: DEFAULT_RULES,
    streams: { ...freshStreams(seed), weave: weave.state() },
  };
}

/** GDD §6.1's floor, in absolute terms. */
export function maxHpFloor(run: RunState): number {
  return Math.ceil(run.baselineMaxHp * MAX_HP_FLOOR_SHARE);
}

/** Where the tags stand right now (GDD §7): the run's memory, made a number. */
export function weaveSnapshot(run: RunState): WeaveSnapshot {
  return { attunement: run.attunement, saturation: saturationOf(run.saturation) };
}

/** Which Depth the run is in, counting from 1 (docs/M1_PLAN.md D21). */
export function depthOf(run: RunState): number {
  return Math.floor(run.encounterIndex / CHAIN_SIZE) + 1;
}

/** Everything combat needs, assembled by the run and read by nobody else. */
export function encounterSetup(run: RunState): CombatSetup {
  const encounter = ENCOUNTERS[run.encounterIndex % ENCOUNTERS.length];
  if (encounter === undefined) throw new RangeError(`no encounter ${String(run.encounterIndex)}`);

  return {
    actors: encounter.actors.map((actor) =>
      actor.side === 'player' ? { ...actor, hp: run.hp, maxHp: run.maxHp } : actor,
    ),
    catalogue: m0Catalogue(),
    deck: run.deck,
    // One stream position per encounter, so replaying a fight replays its
    // shuffle (GDD §20.2) without the run's other systems shifting under it.
    rng: createRng(run.seed + run.encounterIndex, 'combat'),
    rules: run.rules,
    weave: weaveSnapshot(run),
    build: run.build,
  };
}

export interface EncounterResult {
  readonly outcome: CombatOutcome;
  readonly hp: number;
  readonly events: readonly CombatEvent[];
}

/**
 * [M1 STAND-IN] GDD §9's ledger is M2's; this is the least that makes §6 real.
 *
 * Tuned toward §9's stated run totals — 5–7 sockets opened, 4–6 gems crafted —
 * so the gate reads a realistic build rather than an abundant one
 * (docs/M1_PLAN.md D19). Riddles, Wagers and bosses are where Insight actually
 * comes from (§8); until they exist, clearing a fight stands in for all three.
 */
export const CLEAR_MATERIAL_TIER: GemTier = 1;
export const INSIGHT_EVERY = 2;

/**
 * GDD §6.1: "the player starts with one socket already open on their signature
 * card". v0.1 began with zero build expression, which left the first two Depths
 * with no gem play at all — an onboarding hole §6.1 closes explicitly.
 *
 * [M1 STAND-IN] §5.1 owes a real "4 starters + 1 signature" table; until it
 * exists the signature is a Standard card, so the free socket sits on something
 * the player actually reaches for (docs/M1_PLAN.md D30).
 */
export const SIGNATURE_CARD = cardId('cleave');

const OPENING_BUILD: BuildState = {
  gems: {},
  sockets: { [SIGNATURE_CARD]: { opened: 1, gems: [], scarred: false } },
  runtime: {},
};

/**
 * The run, one encounter older (GDD §4.10, §7.3, §9).
 *
 * Saturation is folded from the encounter's own event log rather than tracked
 * alongside it, so the number the Weave panel shows cannot drift from the fight
 * that produced it (CLAUDE.md §2.2).
 */
export function absorbEncounter(run: RunState, result: EncounterResult): RunState {
  if (result.outcome !== 'won') return run;

  const dominant = dominantTag(attributeDamage(result.events, PLAYER));
  const nextIndex = run.encounterIndex + 1;
  const rested = startsChain(nextIndex);

  const banked: RunState = {
    ...run,
    encounterIndex: nextIndex,
    // GDD §4.10: the wound carries. The chain boundary is M0's stand-in for a
    // Sanctum, and restoring to Max HP is what makes the socket cost bite —
    // it lowers the ceiling you are restored to, permanently.
    hp: rested ? run.maxHp : Math.min(result.hp, run.maxHp),
    saturation: recordEncounter(run.saturation, dominant),
    materials: grantMaterial(run.materials, CLEAR_MATERIAL_TIER),
    insight: run.insight + (nextIndex % INSIGHT_EVERY === 0 ? 1 : 0),
  };

  // GDD §7.1: one Ascendant and one Suppressed slot re-roll at the start of
  // Depth 2 and Depth 3 — and nowhere else. Two shifts a run, by design.
  const enteringNewDepth = rested && depthOf(banked) > depthOf(run);
  if (!enteringNewDepth || depthOf(banked) > 3) return banked;

  const shifted = draw(banked, 'weave', (rng) => shiftAttunement(rng, banked.attunement));
  return { ...banked, attunement: shifted.value, streams: shifted.streams };
}

/** A run that ended. Nothing carries between runs (GDD §9). */
export function restartRun(run: RunState): RunState {
  return startRun(run.seed);
}

/**
 * Crafting and socketing, as the run performs them (GDD §6.1, §6.2).
 *
 * Every one of these spends from the run and hands back a new one — the run is
 * a value, like everything else the sim touches. Randomness comes off the
 * `gemRoll` stream and only that stream, which is what keeps a craft from
 * reshuffling a fight (GDD §20.2).
 */
export type ForgeResult<T> =
  | { readonly ok: true; readonly run: RunState; readonly value: T }
  | { readonly ok: false; readonly reason: string };

/** GDD §6.2: material rarity sets the Tier, so a craft spends one of them. */
export function craft(run: RunState, order: { frame: Frame; tier: GemTier }): ForgeResult<GemId> {
  const spent = spendMaterial(run.materials, order.tier);
  if (!spent.ok) return { ok: false, reason: `no tier ${String(order.tier)} material` };

  const rolled = draw(run, 'gemRoll', (rng) =>
    craftGem({ frame: order.frame, tier: order.tier, serial: run.crafted }, rng),
  );
  const gem = rolled.value;

  return {
    ok: true,
    value: gem.id,
    run: {
      ...run,
      materials: spent.materials,
      crafted: run.crafted + 1,
      pouch: [...run.pouch, gem.id],
      build: { ...run.build, gems: { ...run.build.gems, [gem.id]: gem } },
      streams: rolled.streams,
    },
  };
}

/** GDD §6.2: 1 Insight rerolls the values, never the Frame (§22 Q4). */
export function reroll(run: RunState, gem: GemId): ForgeResult<GemId> {
  const existing = run.build.gems[gem];
  if (existing === undefined) return { ok: false, reason: `no gem "${gem}"` };
  if (run.insight < REROLL_INSIGHT_COST) return { ok: false, reason: 'not enough Insight' };

  const rolled = draw(run, 'gemRoll', (rng) => rerollValues(existing, rng));

  return {
    ok: true,
    value: gem,
    run: {
      ...run,
      insight: run.insight - REROLL_INSIGHT_COST,
      build: { ...run.build, gems: { ...run.build.gems, [gem]: rolled.value } },
      streams: rolled.streams,
    },
  };
}

/** One socket attempt on one card (GDD §6.1). Costs Max HP either way. */
export function openSocket(run: RunState, card: CardId): ForgeResult<boolean> {
  const query = {
    sockets: socketsOf(run.build.sockets, card),
    maxHp: run.maxHp,
    floor: maxHpFloor(run),
    insight: run.insight,
  };

  const attempted = draw(run, 'gemRoll', (rng) => attemptSocket(query, rng));
  if ('reason' in attempted.value) return { ok: false, reason: attempted.value.reason };

  const result = attempted.value;
  return {
    ok: true,
    value: result.opened,
    run: {
      ...run,
      maxHp: result.maxHp,
      // The wound is capped by the pool it sits in: a socket lowers the
      // ceiling, and current HP cannot sit above it (GDD §6.1).
      hp: Math.min(run.hp, result.maxHp),
      insight: result.insight,
      build: { ...run.build, sockets: { ...run.build.sockets, [card]: result.sockets } },
      streams: attempted.streams,
    },
  };
}

/** GDD §6.2: socketing is permanent — this is the last reversible moment. */
export function seat(run: RunState, card: CardId, gem: GemId): ForgeResult<CardId> {
  if (!run.pouch.includes(gem)) return { ok: false, reason: `gem "${gem}" is not in the pouch` };

  const sockets = socketsOf(run.build.sockets, card);
  if (sockets.gems.length >= sockets.opened) return { ok: false, reason: 'no open socket' };

  return {
    ok: true,
    value: card,
    run: {
      ...run,
      pouch: run.pouch.filter((held) => held !== gem),
      build: {
        ...run.build,
        sockets: { ...run.build.sockets, [card]: seatGem(sockets, gem) },
      },
    },
  };
}

/** GDD §6.2: "Removal is free but destroys the gem." It does not come back. */
export function unseat(run: RunState, card: CardId, gem: GemId): ForgeResult<CardId> {
  const sockets = socketsOf(run.build.sockets, card);
  if (!sockets.gems.includes(gem)) return { ok: false, reason: `gem "${gem}" is not seated` };

  const { [gem]: destroyed, ...surviving } = run.build.gems;
  void destroyed;

  return {
    ok: true,
    value: card,
    run: {
      ...run,
      build: {
        ...run.build,
        gems: surviving,
        sockets: { ...run.build.sockets, [card]: removeGem(sockets, gem) },
      },
    },
  };
}
