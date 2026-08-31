import { nodeId, type NodeId } from '../sim/ids.ts';
import type { Rng } from '../sim/rng.ts';
import { TAGS, type Tag } from '../sim/tag.ts';

/**
 * The map (GDD §11).
 *
 * > **4 Depths.** Each offers 2 Dungeons, 1 Sanctum, 1 Market; the player takes
 * > **2 nodes**, then the Boss.
 * >
 * > The node types pay in **different currencies** (XP vs. HP vs. gold), so they
 * > can't be ranked against each other — there's nothing to solve.
 *
 * Two rules shape everything below.
 *
 * **The whole map is drawn at run start**, not a Depth at a time. Generating
 * Depth 3 on arrival would make the `map` stream's position depend on the route
 * taken, and a stream position that depends on its own outcome cannot be
 * resumed from a save (§20.2 [AMD]) — the resumed run would silently be in a
 * different world.
 *
 * **Composition is not drawn here.** §11 is explicit: a Dungeon shows its
 * Threat rating and one Omen, and "composition is unknown until entered". That
 * is why there are two streams: `map` lays out the route, `enemyGen` fills a
 * node in at the moment of entry. Commitment before information is a fact about
 * which stream runs when, rather than a convention the UI is asked to honour.
 */

export type NodeKind = 'dungeon' | 'sanctum' | 'market' | 'boss';

/** GDD §11: the one hint a Dungeon gives about what is inside it. */
export interface Omen {
  readonly tag: Tag;
  /** §7.2: hard immunity is elites only, and is always shown before you commit. */
  readonly kind: 'resists' | 'immune';
}

export interface MapNode {
  readonly id: NodeId;
  readonly kind: NodeKind;
  readonly depth: number;
  /** §11's "Threat rating" — what this node adds on top of the world's. */
  readonly rating: number;
  readonly omen: Omen | null;
  /** Fights inside. A Dungeon holds a few; a Boss holds one; a rest holds none. */
  readonly encounters: number;
  readonly elite: boolean;
}

export interface DepthMap {
  readonly depth: number;
  /** Exactly 2 Dungeons, 1 Sanctum, 1 Market (§11). */
  readonly offered: readonly MapNode[];
  readonly boss: MapNode;
}

export interface RunMap {
  readonly depths: readonly DepthMap[];
}

/**
 * Where the run stands within the map (GDD §11). Replaces M0's flat encounter
 * index, which could only ever describe a straight line.
 */
export interface RunPosition {
  readonly depth: number;
  /** Nodes taken this Depth. Two means the Boss is next (§11). */
  readonly taken: readonly NodeId[];
  /** The node being played, or null while standing on the map. */
  readonly node: NodeId | null;
  readonly indexInNode: number;
  readonly dead: boolean;
}

export const STARTING_POSITION: RunPosition = {
  depth: 1,
  taken: [],
  node: null,
  indexInNode: 0,
  dead: false,
};

export const DEPTH_COUNT = 4;
export const NODES_TAKEN_PER_DEPTH = 2;
export const DUNGEONS_PER_DEPTH = 2;

/**
 * How many fights a Dungeon holds. §11's timing budget bills 12 normal and 4
 * elite encounters across the run; with two Dungeons offered and two nodes
 * taken a Depth, that lands near three or four per Dungeon.
 */
const DUNGEON_ENCOUNTERS = [3, 4] as const;

/** §11: a Dungeon node's own difficulty, on top of the world's Threat. */
const RATINGS = [0, 1, 2] as const;

/**
 * Draws a fixed number of times whatever it picks (§20.2 [AMD], M1 D32). Every
 * generator in this file goes through it, so `positionAfter − positionBefore`
 * is a constant for a given map size — which is what makes a resumed run land
 * in the same world as one that never stopped.
 */
function pick<T>(rng: Rng, options: readonly T[]): T {
  const chosen = options[rng.nextInt(options.length)];
  if (chosen === undefined) throw new RangeError('cannot pick from an empty list');
  return chosen;
}

function rollOmen(rng: Rng, elite: boolean): Omen {
  // The tag is drawn either way, so an elite and a normal cost the same number
  // of draws — the alternative would make the position depend on the outcome.
  const tag = pick(rng, TAGS);
  return { tag, kind: elite ? 'immune' : 'resists' };
}

function dungeonAt(rng: Rng, depth: number, index: number): MapNode {
  // An elite becomes possible from Depth 2. Drawn unconditionally at every
  // depth so the draw count does not vary by depth (§20.2).
  const roll = rng.nextInt(4);
  const elite = depth >= 2 && roll === 0;

  return {
    id: nodeId(`d${String(depth)}n${String(index)}`),
    kind: 'dungeon',
    depth,
    rating: pick(rng, RATINGS) + (elite ? 1 : 0),
    omen: rollOmen(rng, elite),
    encounters: pick(rng, DUNGEON_ENCOUNTERS),
    elite,
  };
}

function restAt(kind: 'sanctum' | 'market', depth: number): MapNode {
  return {
    id: nodeId(`d${String(depth)}${kind.charAt(0)}`),
    kind,
    depth,
    rating: 0,
    omen: null,
    encounters: 0,
    elite: false,
  };
}

function bossAt(depth: number): MapNode {
  return {
    id: nodeId(`d${String(depth)}boss`),
    kind: 'boss',
    depth,
    rating: depth,
    // §12.3: no boss may have a hard immunity. It has nothing to hint at.
    omen: null,
    encounters: 1,
    elite: false,
  };
}

function depthAt(rng: Rng, depth: number): DepthMap {
  const dungeons = Array.from({ length: DUNGEONS_PER_DEPTH }, (_, index) =>
    dungeonAt(rng, depth, index),
  );

  return {
    depth,
    // §11's four: the two Dungeons that were rolled, and the two rests that are
    // always on offer. A Sanctum and a Market cost nothing to generate because
    // there is nothing about them to be uncertain about.
    offered: [...dungeons, restAt('sanctum', depth), restAt('market', depth)],
    boss: bossAt(depth),
  };
}

/** GDD §11's four Depths, laid out in one pass at run start. */
export function generateMap(rng: Rng): RunMap {
  return {
    depths: Array.from({ length: DEPTH_COUNT }, (_, index) => depthAt(rng, index + 1)),
  };
}

/**
 * A cheap fingerprint of a generated map (GDD §16).
 *
 * The map is *not* saved — it is regenerated from the seed, because storing it
 * would be storing a derived value. But a later change to this generator would
 * then resume a run into a different world without saying so. The digest is
 * saved instead: it cannot repair the mismatch, but it can refuse to pretend
 * there isn't one.
 */
export function digestOf(map: RunMap): number {
  const shape = map.depths
    .flatMap((depth) => [...depth.offered, depth.boss])
    .map(
      (node) =>
        `${node.id}${node.kind}${String(node.rating)}${String(node.encounters)}` +
        `${node.omen?.tag ?? ''}${node.omen?.kind ?? ''}${String(node.elite)}`,
    )
    .join('|');

  let hash = FNV_OFFSET;
  for (const character of shape) hash = Math.imul(hash ^ character.charCodeAt(0), FNV_PRIME);
  return hash >>> 0;
}

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

export function depthMapAt(map: RunMap, depth: number): DepthMap {
  const found = map.depths[depth - 1];
  if (found === undefined) throw new RangeError(`no Depth ${String(depth)}`);
  return found;
}

export function nodeIn(depth: DepthMap, id: NodeId): MapNode | null {
  return depth.offered.find((node) => node.id === id) ?? (depth.boss.id === id ? depth.boss : null);
}
