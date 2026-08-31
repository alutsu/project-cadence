import { ARCHETYPES, type EnemyArchetype } from '../data/archetypes.ts';
import { scaleEnemy } from '../data/encounters.ts';
import type { ActorSeed } from '../sim/combat.ts';
import type { Rng } from '../sim/rng.ts';
import type { Omen } from './map.ts';

/**
 * Encounter generation (GDD §12.1).
 *
 * > `archetype + modifier + level`.
 *
 * The problem this exists to solve is the one M2/S3's measurement found: the
 * six authored encounters were balanced against M0's twelve-card deck, so a map
 * that reused them handed a level-1 character a solo Warden whose Poise was
 * higher than anything in a five-card deck could hit. That is not a difficult
 * fight, it is an unavailable one — the whole Stagger puzzle the Warden is built
 * around simply is not offered.
 *
 * A generated encounter is built to a **budget** instead, which makes §12.2's
 * rule arithmetic rather than judgement: "a second enemy adds its whole damage
 * output while adding only its own HP to the pool", so a duo must be built from
 * cheaper parts than the solo fight before it.
 */

/** GDD §4.8: one to four enemies, never more. */
export const MAX_ENEMIES = 4;

/**
 * What a fight at this level may spend. A Depth-1 opener buys one rat; a
 * late-run node buys a Warden and company.
 *
 * Deliberately linear and deliberately shallow at the bottom. The alternative
 * — starting the budget where the authored encounters sat — is what made
 * Depth 1 unplayable, and the cost of erring low is a boring first fight rather
 * than an impossible one.
 */
export function budgetFor(level: number): number {
  return OPENING_BUDGET + Math.floor(Math.max(0, level) / LEVELS_PER_POINT);
}

/**
 * Two, so the first fight of a run is a pair of rats rather than a single one.
 * A playtest's opening node was three fights of eight ticks and three damage
 * apiece — not a difficulty problem, but not a fight either.
 */
const OPENING_BUDGET = 2;

/**
 * How fast the budget grows. Linear in the level tripled a fight's size between
 * two adjacent nodes — 34 HP of enemies to 118 — which is the cliff a playtest
 * died on six times running. Growth has to be slower than the deck's.
 */
const LEVELS_PER_POINT = 3;

export interface EncounterOrder {
  readonly level: number;
  readonly elite: boolean;
  /** What the node advertised (§11). The line has to honour it. */
  readonly omen: Omen | null;
}

/**
 * The archetype an Omen promised, if any. §11 shows one tag before the player
 * commits, and a generated line that ignored it would make the map a liar.
 */
function omenBearer(omen: Omen | null, level: number): EnemyArchetype | null {
  if (omen === null) return null;

  return (
    ARCHETYPES.find((archetype) => {
      if (archetype.minLevel > level) return false;
      const resistance = archetype.resistances[omen.tag];
      return resistance.kind === 'resist' && resistance.value > 0;
    }) ?? null
  );
}

/** One draw, from the whole roster. Affordability is judged after, not before. */
function pick(rng: Rng, pool: readonly EnemyArchetype[]): EnemyArchetype | null {
  if (pool.length === 0) return null;
  return pool[rng.nextInt(pool.length)] ?? null;
}

/**
 * A line built to the level's budget (GDD §12.1, §4.8).
 *
 * An elite spends more, which is what an elite is: §9 pays better for one and
 * §10 hangs a relic off it, so it has to be worth the node.
 */
export function generateEncounter(order: EncounterOrder, rng: Rng): readonly ActorSeed[] {
  const level = Math.max(0, order.level);
  let remaining = budgetFor(level) + (order.elite ? 2 : 0);

  const chosen: EnemyArchetype[] = [];
  const promised = omenBearer(order.omen, level);
  if (promised !== null && promised.cost <= remaining) {
    chosen.push(promised);
    remaining -= promised.cost;
  }

  // Exactly one draw per slot, always, whatever it lands on (§20.2 [AMD]).
  // A slot whose draw does not fit the remaining budget is simply left empty —
  // filtering the pool first, or re-rolling until something fit, would both
  // make the number of draws depend on the budget, and a stream position that
  // depends on its own outcome cannot be resumed from a save.
  // Filtered by level, which is fixed for the whole encounter, so the draw
  // count still cannot depend on the outcome (§20.2 [AMD]). Filtering by the
  // *remaining budget* would not be safe here for exactly that reason.
  const pool = ARCHETYPES.filter((archetype) => archetype.minLevel <= level);

  for (let slot = chosen.length; slot < MAX_ENEMIES; slot += 1) {
    const drawn = pick(rng, pool);
    if (drawn === null || drawn.cost > remaining) continue;

    chosen.push(drawn);
    remaining -= drawn.cost;
  }

  // A fight with nothing in it is not a fight; the cheapest thing always fits.
  const line = chosen.length > 0 ? chosen : [cheapest()];

  return line.map((archetype, index) =>
    scaleEnemy(archetype, level, `${archetype.id}_${String(index)}`),
  );
}

function cheapest(): EnemyArchetype {
  const found = [...ARCHETYPES].sort((left, right) => left.cost - right.cost)[0];
  if (found === undefined) throw new Error('the archetype roster is empty');
  return found;
}
