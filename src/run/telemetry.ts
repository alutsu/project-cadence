import type { CombatEvent } from '../sim/events.ts';
import type { ActorId, CardId } from '../sim/ids.ts';
import { attributeDamage, dominantTag } from '../sim/saturation.ts';
import type { Tag } from '../sim/tag.ts';
import type { MapNode } from './map.ts';
import { maxHpFloor, type RunState } from './RunState.ts';

/**
 * What a playtest records (GDD §19).
 *
 * > **Telemetry from playtesters:** run seed, build snapshot at each Depth,
 * > death cause, encounter durations, cards never played.
 *
 * Every figure below is **read off the event log or off run state**, never
 * tracked alongside them (CLAUDE.md §2.2). A telemetry number that is
 * maintained separately is a number that can disagree with the game it claims
 * to describe, which makes it worse than none — it would send us chasing a
 * balance problem that only exists in the recorder.
 *
 * Pure and synchronous. Shipping it anywhere is `/platform`'s job.
 */

export type PlaytestEvent =
  | {
      readonly kind: 'run_started';
      readonly seed: number;
      readonly attunement: Readonly<Record<string, string>>;
    }
  | { readonly kind: 'node_entered'; readonly node: NodeRecord }
  | { readonly kind: 'encounter_ended'; readonly encounter: EncounterRecord }
  | { readonly kind: 'forged'; readonly action: string; readonly after: PurseRecord }
  | { readonly kind: 'run_ended'; readonly summary: RunSummaryRecord };

export interface NodeRecord {
  readonly depth: number;
  readonly kind: string;
  readonly rating: number;
  readonly elite: boolean;
  readonly omen: string | null;
  readonly threat: number;
  readonly level: number;
  readonly playerLevel: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly deck: number;
}

export interface EncounterRecord {
  readonly depth: number;
  readonly node: string;
  readonly won: boolean;
  /** §19 asks for encounter durations; ticks are the unit the game runs on. */
  readonly ticks: number;
  readonly decisions: number;
  /**
   * HP on *entering*, before the opening exchange. §4.1 lets a faster enemy act
   * before the player ever sees the board, so reading it off the opened state
   * quietly attributed that first bite to nothing — the log said "70/70 HP"
   * and then "67→" on the next line.
   */
  readonly hpBefore: number;
  readonly hpAfter: number;
  readonly enemies: readonly string[];
  readonly cardsPlayed: Readonly<Record<string, number>>;
  readonly damageByTag: Readonly<Record<string, number>>;
  readonly dominantTag: Tag | null;
  readonly staggers: number;
  readonly guardAbsorbed: number;
  readonly damageTaken: number;
  /** What finished the player, when something did (§13's "death cause"). */
  readonly killedBy: string | null;
}

export interface PurseRecord {
  readonly materials: number;
  readonly insight: number;
  readonly maxHp: number;
  readonly floor: number;
  readonly sockets: number;
}

export interface RunSummaryRecord {
  readonly seed: number;
  readonly won: boolean;
  readonly depthReached: number;
  readonly threat: number;
  readonly level: number;
  readonly hp: number;
  readonly maxHp: number;
  /** §13: the build snapshot. Which card carries which frames. */
  readonly build: Readonly<Record<string, readonly string[]>>;
  /** §19 names this one directly, and it is the cheapest balance finding. */
  readonly cardsNeverPlayed: readonly string[];
  readonly saturation: readonly (string | null)[];
}

export function purseOf(run: RunState): PurseRecord {
  return {
    materials: Object.values(run.materials).reduce((total, held) => total + held, 0),
    insight: run.insight,
    maxHp: run.maxHp,
    floor: maxHpFloor(run),
    sockets: Object.values(run.build.sockets).reduce((total, s) => total + s.opened, 0),
  };
}

export function nodeRecord(run: RunState, node: MapNode, level: number): NodeRecord {
  return {
    depth: node.depth,
    kind: node.kind,
    rating: node.rating,
    elite: node.elite,
    omen: node.omen === null ? null : `${node.omen.kind} ${node.omen.tag}`,
    threat: run.threat,
    level,
    playerLevel: run.level,
    hp: run.hp,
    maxHp: run.maxHp,
    deck: run.deck.length,
  };
}

interface EncounterInput {
  readonly node: MapNode;
  /** HP the run entered on, which is not the HP the first turn opens on. */
  readonly hpOnEntry: number;
  readonly hpAfter: number;
  readonly won: boolean;
  /** §19 asks for encounter durations; ticks are the unit the game runs on. */
  readonly ticks: number;
  readonly events: readonly CombatEvent[];
  readonly player: ActorId;
  /** Names an actor for the death cause, since the log carries only ids. */
  readonly nameOf: (actor: ActorId) => string;
}

/** One fight, read entirely off its own log (CLAUDE.md §2.2). */
export function encounterRecord(input: EncounterInput): EncounterRecord {
  const { events, player } = input;
  const cardsPlayed: Record<string, number> = {};
  let decisions = 0;
  let staggers = 0;
  let guardAbsorbed = 0;
  let damageTaken = 0;
  let killedBy: string | null = null;
  let lastHarm: string | null = null;

  for (const event of events) {
    if (event.kind === 'card_played') {
      cardsPlayed[event.card] = (cardsPlayed[event.card] ?? 0) + 1;
      decisions += 1;
    } else if (event.kind === 'guarded') decisions += 1;
    else if (event.kind === 'staggered') staggers += 1;
    else if (event.kind === 'guard_absorbed' && event.actor === player)
      guardAbsorbed += event.amount;
    else if (event.kind === 'damage_dealt' && event.target === player) {
      damageTaken += event.amount;
      lastHarm = input.nameOf(event.source);
    } else if (event.kind === 'status_proc' && event.actor === player) {
      damageTaken += event.amount;
      lastHarm = event.status;
    } else if (event.kind === 'actor_died' && event.actor === player) killedBy = lastHarm;
  }

  const byTag = attributeDamage(events, player);

  return {
    depth: input.node.depth,
    node: input.node.id,
    won: input.won,
    ticks: input.ticks,
    decisions,
    hpBefore: input.hpOnEntry,
    hpAfter: input.hpAfter,
    enemies: enemiesIn(events, input.nameOf),
    cardsPlayed,
    damageByTag: { ...byTag },
    dominantTag: dominantTag(byTag),
    staggers,
    guardAbsorbed,
    damageTaken,
    killedBy,
  };
}

/**
 * Who was in the fight, read off the log rather than off a board snapshot.
 *
 * Anything that was scheduled at the start acted or was acted upon, so the log
 * names every participant — which means this module needs no `CombatState` at
 * all, and the record can be built by whoever owns the run rather than only by
 * whoever owns the board.
 */
function enemiesIn(
  events: readonly CombatEvent[],
  nameOf: (actor: ActorId) => string,
): readonly string[] {
  const seen = new Set<string>();
  for (const event of events) {
    if (event.kind !== 'actor_scheduled') continue;
    const name = nameOf(event.actor);
    if (name !== 'Adventurer') seen.add(name);
  }
  return [...seen];
}

/** §13's run summary, and §19's "cards never played". */
export function runSummary(
  run: RunState,
  won: boolean,
  played: ReadonlySet<CardId>,
): RunSummaryRecord {
  const build: Record<string, readonly string[]> = {};
  for (const [card, sockets] of Object.entries(run.build.sockets)) {
    build[card] = sockets.gems.map((id) => run.build.gems[id]?.frame ?? '?');
  }

  return {
    seed: run.seed,
    won,
    depthReached: run.position.depth,
    threat: run.threat,
    level: run.level,
    hp: run.hp,
    maxHp: run.maxHp,
    build,
    cardsNeverPlayed: run.deck.filter((card) => !played.has(card)),
    saturation: run.saturation.recent,
  };
}
