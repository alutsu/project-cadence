import { PLAYER, PLAYER_SEED } from '../data/encounters.ts';
import { bossFor } from '../data/bosses.ts';
import { generateEncounter } from './generate.ts';
import { deckAtLevel, skillTable, type SkillTable } from '../data/skills.ts';
import {
  bankXp,
  enemyLevel,
  maxHpAtLevel,
  MAX_HP_PER_LEVEL,
  STARTING_LEVEL,
  xpAwarded,
} from '../sim/level.ts';
import type { CombatSetup } from '../sim/combat.ts';
import type { CombatEvent } from '../sim/events.ts';
import { type BuildState, type Frame, type GemTier } from '../sim/gem.ts';
import type { CardId, GemId } from '../sim/ids.ts';
import {
  createRng,
  restoreRng,
  RNG_STREAM_NAMES,
  type Rng,
  type RngState,
  type RngStreamName,
} from '../sim/rng.ts';
import { DEFAULT_RULES, ULTIMATE_KILL_INSIGHT, type CombatRules } from '../sim/rules.ts';
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
import {
  depthMapAt,
  generateMap,
  nodeIn,
  STARTING_POSITION,
  type MapNode,
  type RunMap,
  type RunPosition,
} from './map.ts';
import { rollReward, type RewardKind } from './economy.ts';
import {
  grantMaterial,
  NO_MATERIALS,
  spendMaterial,
  upgradeMaterial,
  type Materials,
} from './materials.ts';
import { craftGem, REROLL_INSIGHT_COST, rerollValues } from './forge.ts';
import {
  attemptSocket,
  removeGem,
  seatGem,
  socketRefusal,
  socketsOf,
  type SocketRefusal,
} from './socket.ts';

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

/** GDD §6.1: Max HP may never fall below 40% of the level baseline. */
export const MAX_HP_FLOOR_SHARE = 0.4;

export interface RunState {
  readonly seed: number;
  /**
   * §11's four Depths, laid out once at run start. **Not persisted** — it is
   * regenerated from the seed, because storing it would be storing a derived
   * value; `mapDigest` is what a save carries instead (GDD §16).
   */
  readonly map: RunMap;
  readonly position: RunPosition;
  /** GDD §5.1. Grants a skill and +6 Max HP; the deck follows from it. */
  readonly level: number;
  /** Banked toward the next level (GDD §5.2). */
  readonly xp: number;
  /** GDD §5.3: every dungeon node entered raises it, pushing enemies up. */
  readonly threat: number;
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
  readonly gold: number;
  readonly insight: number;
  /** Cards removed this run, which is what sets the next removal's price (§9). */
  readonly removals: number;
  /** Gems crafted but not yet seated. Socketing is permanent (§6.2). */
  readonly pouch: readonly GemId[];
  /** Distinguishes one crafted gem from the next, and survives a save. */
  readonly crafted: number;
  readonly rules: CombatRules;
  /** GDD §16, §20.2: stream positions are part of the save and the summary. */
  readonly streams: Readonly<Record<RngStreamName, RngState>>;
}

const STREAM_NAMES: readonly RngStreamName[] = RNG_STREAM_NAMES;

function freshStreams(seed: number): Readonly<Record<RngStreamName, RngState>> {
  const streams: Partial<Record<RngStreamName, RngState>> = {};
  for (const name of STREAM_NAMES) streams[name] = createRng(seed, name).state();
  return {
    map: streams.map ?? createRng(seed, 'map').state(),
    reward: streams.reward ?? createRng(seed, 'reward').state(),
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
  // Drawn once, at the start, so the stream position cannot depend on the route
  // the player later takes (GDD §20.2 [AMD]).
  const map = createRng(seed, 'map');

  return {
    seed,
    map: generateMap(map),
    position: STARTING_POSITION,
    level: STARTING_LEVEL,
    xp: 0,
    threat: 0,
    hp: maxHpAtLevel(STARTING_LEVEL),
    maxHp: maxHpAtLevel(STARTING_LEVEL),
    baselineMaxHp: maxHpAtLevel(STARTING_LEVEL),
    attunement,
    saturation: NO_HISTORY,
    build: OPENING_BUILD,
    deck: deckAtLevel(SKILLS, STARTING_LEVEL),
    materials: NO_MATERIALS,
    gold: 0,
    insight: 0,
    removals: 0,
    pouch: [],
    crafted: 0,
    rules: DEFAULT_RULES,
    streams: { ...freshStreams(seed), weave: weave.state(), map: map.state() },
  };
}

/** What a rest would restore (GDD §11). The view is not allowed to subtract. */
export function missingHp(run: RunState): number {
  return Math.max(0, run.maxHp - run.hp);
}

/** Whether any card in the deck could take another socket right now (§6.1). */
export function canOpenAnySocket(run: RunState): boolean {
  return [...new Set(run.deck)].some((card) => socketRefusalFor(run, card) === null);
}

/** §6.1's own refusal, for one card. The single place the rules are read. */
export function socketRefusalFor(run: RunState, card: CardId): SocketRefusal | null {
  return socketRefusal({
    sockets: socketsOf(run.build.sockets, card),
    maxHp: run.maxHp,
    floor: maxHpFloor(run),
    insight: run.insight,
  });
}

/** GDD §6.1's floor, in absolute terms. */
export function maxHpFloor(run: RunState): number {
  return Math.ceil(run.baselineMaxHp * MAX_HP_FLOOR_SHARE);
}

/** Where the tags stand right now (GDD §7): the run's memory, made a number. */
export function weaveSnapshot(run: RunState): WeaveSnapshot {
  return { attunement: run.attunement, saturation: saturationOf(run.saturation) };
}

/** Which Depth the run is in, counting from 1 (GDD §11). */
export function depthOf(run: RunState): number {
  return run.position.depth;
}

/**
 * Everything combat needs, assembled by the run and read by nobody else.
 *
 * [M2 STAND-IN] §12.1's generator is S4's; until then a node's composition is
 * drawn from the authored roster and re-levelled to what the node advertised.
 * The *timing* is already right, which is the part that matters: this runs at
 * entry, off a different stream from the one that laid the map out, so §11's
 * "composition is unknown until entered" is a fact about the code.
 */
export function encounterSetupFor(run: RunState, node: MapNode): CombatSetup {
  const level = enemyLevel(node.depth - 1, run.threat) + node.rating;

  // A boss is authored, not generated (GDD §12.3): each one attacks a different
  // assumption, which is not a thing a budget can express. Everything else is
  // drawn here, at entry, off `enemyGen` — a different stream from the one that
  // laid the map out, so §11's "composition is unknown until entered" is a fact
  // about which stream runs when rather than a convention the UI honours.
  const enemies =
    node.kind === 'boss'
      ? bossFor(node.depth, level)
      : generateEncounter(
          { level, elite: node.elite, omen: node.omen },
          restoreRng({ ...run.streams.enemyGen, position: encounterDraw(run, node) }),
        );

  return {
    actors: [{ ...PLAYER_SEED, hp: run.hp, maxHp: run.maxHp }, ...enemies],
    catalogue: SKILLS.catalogue,
    deck: run.deck,
    // Hashed rather than added, so two nodes at different Depths cannot share
    // a shuffle — `seed + index` collided as soon as there was more than a line.
    rng: createRng(combatSeedFor(run, node), 'combat'),
    rules: run.rules,
    weave: weaveSnapshot(run),
    build: run.build,
  };
}

/**
 * Where in the `enemyGen` stream this node's line is drawn from.
 *
 * Derived rather than advanced, so re-entering the same node at the same point
 * in a run yields the same line — which is what makes §16's "an encounter is
 * atomic; resume replays it from its start state" true without the composition
 * having to be written into the save.
 */
function encounterDraw(run: RunState, node: MapNode): number {
  const parts = [node.depth, node.rating, run.position.indexInNode, run.threat];
  return parts.reduce((total, part) => total * ENCOUNTER_DRAW_SPREAD + part, 0) % DRAW_LIMIT;
}

const ENCOUNTER_DRAW_SPREAD = 31;
const DRAW_LIMIT = 1_000_000;

/** A distinct shuffle per node per fight, from the run's one seed (§20.2). */
function combatSeedFor(run: RunState, node: MapNode): number {
  let hash = run.seed | 0;
  for (const part of [node.depth, node.rating, run.position.indexInNode, node.id.length]) {
    hash = Math.imul(hash ^ part, 16777619);
  }
  for (const character of node.id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}

export interface EncounterResult {
  readonly outcome: CombatOutcome;
  readonly hp: number;
  readonly events: readonly CombatEvent[];
  /** What the encounter was worth before §5.2's level scaling. */
  readonly baseXp: number;
}

/**
 * The node the run is standing in, if any.
 *
 * Lives here rather than in `runFlow` because the reward table needs it and
 * `runFlow` imports this module, not the other way round.
 */
export function nodeStandingOn(run: RunState): MapNode | null {
  const id = run.position.node;
  return id === null ? null : nodeIn(depthMapAt(run.map, run.position.depth), id);
}

/**
 * Which row of §9's sources table a cleared fight is paid from.
 *
 * A Dungeon flagged elite pays the elite row even though it is the same node
 * kind — §12 makes an elite a property of the encounter, not a place.
 */
export function rewardKindOf(run: RunState): RewardKind {
  const node = nodeStandingOn(run);
  if (node === null) return 'normal';
  if (node.kind === 'boss') return 'boss';
  return node.elite ? 'elite' : 'normal';
}

function depthBase(run: RunState): number {
  return run.position.depth - 1;
}

/**
 * GDD §7.1: one Ascendant and one Suppressed slot re-roll at the start of Depth
 * 2 and Depth 3 — and nowhere else. Two shifts a run, announced at the end of
 * the preceding Depth. Called by the flow when a Depth is entered.
 */
export function shiftForDepth(run: RunState, depth: number): RunState {
  if (depth !== 2 && depth !== 3) return run;

  const shifted = draw(run, 'weave', (rng) => shiftAttunement(rng, run.attunement));
  return { ...run, attunement: shifted.value, streams: shifted.streams };
}

/**
 * XP banked, and everything a level brings with it (GDD §5.1).
 *
 * A level grants a skill *and* +6 Max HP, and the two arrive together: the deck
 * is re-derived from the authored order rather than appended to, because §5.1
 * makes the deck a function of the level and not a list that accumulates.
 *
 * The Max HP gain is added to both the pool and the §6.1 baseline. The baseline
 * is what the socket floor is 40% of, so a level genuinely widens the room a
 * build has to spend — which is the whole reason §5.1 [FIX] made HP grow.
 */
function levelUp(run: RunState, award: { baseXp: number; enemyLevel: number }): RunState {
  const gained = xpAwarded({
    baseXp: award.baseXp,
    enemyLevel: award.enemyLevel,
    playerLevel: run.level,
  });
  const progress = bankXp({ level: run.level, xp: run.xp }, gained);
  const levels = progress.level - run.level;
  if (levels <= 0) return { ...run, xp: progress.xp };

  const grown = levels * MAX_HP_PER_LEVEL;
  return {
    ...run,
    level: progress.level,
    xp: progress.xp,
    maxHp: run.maxHp + grown,
    baselineMaxHp: run.baselineMaxHp + grown,
    // A level heals nothing by itself (§5.1 grants a pool, not a refill), but
    // the wound cannot exceed the pool it sits in.
    hp: Math.min(run.hp + grown, run.maxHp + grown),
    deck: deckAtLevel(SKILLS, progress.level),
  };
}

/**
 * [M2 STAND-IN] What a normal encounter is worth before §5.2 scales it. §9's
 * table says only "base"; the number is tuned against §5.1's curve so a full
 * run reaches somewhere near the cap (docs/M2_PLAN.md D42).
 */
export const NORMAL_BASE_XP = 10;

/**
 * [M1 STAND-IN] GDD §9's ledger arrives with the Market; this is the least
 * that makes §6 real.
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
export const SKILLS: SkillTable = skillTable();

/** GDD §5.1's signature, read from the table rather than named twice. */
export const SIGNATURE_CARD: CardId = SKILLS.signature;

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
  // GDD §22 Q1 candidate (b): an Ultimate that finishes something pays for
  // itself in Insight. Counted from the log by the run layer rather than
  // granted by the reducer, because Insight is run-scoped and /sim cannot
  // reach it (docs/M1_PLAN.md D25).
  const paid = run.rules.ultimate === 'insight' ? ultimateKills(result.events) : 0;

  // GDD §5.2, §5.3. The level a fight was worth is the level of what was in
  // it, which §5.3 ties to Threat — so farming pushes enemies past you rather
  // than behind you, and the XP clamp stops it paying either way.
  const grown = levelUp(run, {
    baseXp: result.baseXp,
    enemyLevel: enemyLevel(depthBase(run), run.threat),
  });

  // GDD §9's sources table, replacing M1's D19 stand-in — that granted a
  // material on every clear and Insight on a fixed cadence, because there was
  // no notion of an elite or a boss to pay differently. There is now.
  const rolled = draw(grown, 'reward', (rng) => rollReward(rewardKindOf(run), rng));

  const banked: RunState = {
    ...grown,
    streams: rolled.streams,
    // GDD §4.10: the wound carries. The chain boundary is M0's stand-in for a
    // Sanctum, and restoring to Max HP is what makes the socket cost bite —
    // it lowers the ceiling you are restored to, permanently.
    // §11: the Sanctum is the rest now, not a chain boundary. A wound carries
    // until the player spends a node on healing it (GDD §4.10 [AMD]).
    hp: Math.min(result.hp, grown.maxHp),
    saturation: recordEncounter(run.saturation, dominant),
    gold: grown.gold + rolled.value.gold,
    materials:
      rolled.value.material === null
        ? grown.materials
        : grantMaterial(grown.materials, rolled.value.material),
    insight: grown.insight + rolled.value.insight + paid,
  };

  return banked;
}

/**
 * Kills an Ultimate landed, read off the log (GDD §22 Q1 candidate b).
 *
 * An Ultimate is credited with everything that dies before the player's next
 * card — the same attribution window the balance ledger uses, and the honest
 * one for an AoE that clears a line in one swing.
 */
function ultimateKills(events: readonly CombatEvent[]): number {
  const catalogue = SKILLS.catalogue;
  let credited = false;
  let kills = 0;

  for (const event of events) {
    if (event.kind === 'card_played') {
      credited = catalogue[event.card]?.weightClass === 'ultimate';
      continue;
    }
    if (event.kind === 'actor_died' && credited) kills += ULTIMATE_KILL_INSIGHT;
  }

  return kills;
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

/**
 * One forge act, performed against the run (GDD §6.1, §6.2).
 *
 * The screen asks; the run decides. Returns null when the act could not be
 * taken, so the caller re-renders unchanged rather than showing something that
 * did not happen — an illegal act is an expected failure, not an exception
 * (CLAUDE.md §5.4).
 */
export function performForgeAction(
  run: RunState,
  action: {
    readonly kind: 'craft' | 'socket' | 'seat' | 'unseat' | 'reroll' | 'upgrade';
    readonly card: CardId | null;
    readonly frame: Frame | null;
    readonly tier: GemTier;
  },
): RunState | null {
  if (action.kind === 'upgrade')
    return { ...run, materials: upgradeMaterial(run.materials, action.tier) };
  if (action.kind === 'craft') {
    const made = craft(run, { frame: action.frame ?? 'REPEAT', tier: action.tier });
    return made.ok ? made.run : null;
  }
  if (action.kind === 'reroll') {
    const newest = run.pouch[run.pouch.length - 1];
    if (newest === undefined) return null;
    const again = reroll(run, newest);
    return again.ok ? again.run : null;
  }

  const card = action.card;
  if (card === null) return null;
  if (action.kind === 'socket') {
    const opened = openSocket(run, card);
    return opened.ok ? opened.run : null;
  }
  if (action.kind === 'seat') {
    const gem = run.pouch[0];
    if (gem === undefined) return null;
    const seated = seat(run, card, gem);
    return seated.ok ? seated.run : null;
  }

  const seated = socketsOf(run.build.sockets, card).gems[0];
  if (seated === undefined) return null;
  const removed = unseat(run, card, seated);
  return removed.ok ? removed.run : null;
}
