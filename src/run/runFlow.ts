import type { CombatSetup } from '../sim/combat.ts';
import type { CombatEvent } from '../sim/events.ts';
import type { NodeId } from '../sim/ids.ts';
import { enemyLevel, THREAT_PER_NODE } from '../sim/level.ts';
import {
  depthMapAt,
  nodeIn,
  DEPTH_COUNT,
  NODES_TAKEN_PER_DEPTH,
  STARTING_POSITION,
  type MapNode,
} from './map.ts';
import {
  absorbEncounter,
  encounterSetupFor,
  NORMAL_BASE_XP,
  shiftForDepth,
  type RunState,
} from './RunState.ts';

/**
 * The run, as a reducer (GDD §20.3's argument, applied one layer up).
 *
 * Combat is a reducer because a pure one makes the ghost preview trivial and
 * the balance simulation possible at all. The *run* is a reducer for the second
 * of those reasons: the harness plays a whole run — node choices, rests, the
 * lot — through `advanceRun`, which is **the same function the game calls**. A
 * balance number is then a measurement of the shipping flow rather than of a
 * parallel re-implementation that drifts from it.
 *
 * Zero Phaser, zero DOM. `RunScene` is wiring over this, exactly as
 * `CombatScene` is wiring over `reduce`.
 */

/** Where the run is, and what it is being asked. */
export type RunView =
  | { readonly kind: 'map'; readonly depth: number; readonly offered: readonly MapNode[] }
  | { readonly kind: 'encounter'; readonly node: MapNode; readonly setup: CombatSetup }
  | { readonly kind: 'sanctum'; readonly node: MapNode }
  | { readonly kind: 'market'; readonly node: MapNode }
  | { readonly kind: 'summary'; readonly won: boolean };

export type RunIntent =
  | { readonly kind: 'enterNode'; readonly node: NodeId }
  | { readonly kind: 'finishEncounter'; readonly result: EncounterOutcome }
  | { readonly kind: 'rest' }
  | { readonly kind: 'leaveNode' };

export interface EncounterOutcome {
  readonly won: boolean;
  readonly hp: number;
  readonly events: readonly CombatEvent[];
}

export interface RunStep {
  readonly run: RunState;
  /** True when §16 requires a write: a node boundary, or an encounter's end. */
  readonly savePoint: boolean;
}

/** Which node the run is standing in, if any. */
function currentNode(run: RunState): MapNode | null {
  const id = run.position.node;
  return id === null ? null : nodeIn(depthMapAt(run.map, run.position.depth), id);
}

/**
 * §11: the Boss is offered once two nodes have been taken, and nothing else is.
 * A Depth is not a menu you exhaust — it is two choices out of four.
 */
function offeredAt(run: RunState): readonly MapNode[] {
  const depth = depthMapAt(run.map, run.position.depth);
  if (run.position.taken.length >= NODES_TAKEN_PER_DEPTH) return [depth.boss];

  return depth.offered.filter((node) => !run.position.taken.includes(node.id));
}

export function viewOf(run: RunState): RunView {
  if (run.position.dead) return { kind: 'summary', won: false };
  if (run.position.depth > DEPTH_COUNT) return { kind: 'summary', won: true };

  const node = currentNode(run);
  if (node === null) {
    return { kind: 'map', depth: run.position.depth, offered: offeredAt(run) };
  }
  if (node.kind === 'sanctum') return { kind: 'sanctum', node };
  if (node.kind === 'market') return { kind: 'market', node };

  return { kind: 'encounter', node, setup: encounterSetupFor(run, node) };
}

/**
 * §5.3: `enemy_level = depth_base + floor(Threat / 2)`, plus what this
 * particular node advertised. The node's own rating is the part §11 shows
 * before you commit; the Threat term is the part your own route decides.
 */
export function levelOf(run: RunState, node: MapNode): number {
  return enemyLevel(node.depth - 1, run.threat) + node.rating;
}

export function advanceRun(run: RunState, intent: RunIntent): RunStep {
  switch (intent.kind) {
    case 'enterNode':
      return { run: enterNode(run, intent.node), savePoint: true };
    case 'finishEncounter':
      return finishEncounter(run, intent.result);
    case 'rest':
      return { run: rest(run), savePoint: true };
    case 'leaveNode':
      return { run: leaveNode(run), savePoint: true };
  }
}

function enterNode(run: RunState, id: NodeId): RunState {
  const depth = depthMapAt(run.map, run.position.depth);
  const node = nodeIn(depth, id);
  if (node === null || !offeredAt(run).some((offered) => offered.id === id)) return run;

  return {
    ...run,
    // §5.3: entering raises world Threat, so farming pushes enemies past you
    // rather than behind you. The rests do not — they cost the node instead.
    threat:
      node.kind === 'dungeon' || node.kind === 'boss' ? run.threat + THREAT_PER_NODE : run.threat,
    position: { ...run.position, node: id, indexInNode: 0 },
  };
}

function finishEncounter(run: RunState, result: EncounterOutcome): RunStep {
  const node = currentNode(run);
  if (node === null) return { run, savePoint: false };

  if (!result.won) {
    // §13: HP ≤ 0 ends the run immediately. No revives, no second chances.
    return { run: { ...run, hp: 0, position: { ...run.position, dead: true } }, savePoint: true };
  }

  const banked = absorbEncounter(run, {
    outcome: 'won',
    hp: result.hp,
    events: result.events,
    baseXp: NORMAL_BASE_XP,
  });
  const next = run.position.indexInNode + 1;

  // A node is finished only when every fight in it is (§11: a Dungeon holds
  // several). Until then the run stays inside it, wound and all.
  if (next < node.encounters) {
    return {
      run: { ...banked, position: { ...run.position, indexInNode: next } },
      savePoint: true,
    };
  }

  return { run: leaveNode({ ...banked, position: run.position }), savePoint: true };
}

/** GDD §11: the Sanctum is free, but it costs the node. */
function rest(run: RunState): RunState {
  const node = currentNode(run);
  if (node?.kind !== 'sanctum') return run;

  // Heals HP and never Max HP: a Sanctum that restored the pool would refund
  // the one cost §6.1 charges, and the socket would stop being a decision.
  return leaveNode({ ...run, hp: run.maxHp });
}

/** Back to the map — or on to the next Depth, once the Boss has fallen. */
function leaveNode(run: RunState): RunState {
  const node = currentNode(run);
  if (node === null) return run;

  if (node.kind === 'boss') {
    const depth = run.position.depth + 1;
    // §7.1: the Attunement re-rolls one Ascendant and one Suppressed slot at
    // the *start* of Depth 2 and Depth 3 — so it happens here, on the Depth
    // transition, and nowhere else. Two shifts a run, by design.
    return shiftForDepth(
      { ...run, position: { ...STARTING_POSITION, depth, dead: run.position.dead } },
      depth,
    );
  }

  return {
    ...run,
    position: {
      ...run.position,
      node: null,
      indexInNode: 0,
      taken: [...run.position.taken, node.id],
    },
  };
}
