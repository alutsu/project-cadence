import { relicTable, type RelicDefinition } from '../data/relics.ts';
import { foldRelicAtoms, type RelicLevers } from '../sim/relicEffects.ts';
import type { Rng } from '../sim/rng.ts';

/**
 * Which relics a run holds, and what they add up to (GDD §10).
 *
 * §10: *"1 per elite kill (choice of 2) plus Market purchases."* A relic is
 * permanent for the run and nothing carries between runs (§9), so the run holds
 * ids and the levers are **derived** rather than stored — a saved fold could
 * disagree with the relics that produced it, and there is no version of that
 * bug worth the bytes it saves.
 */

/** How many a kill offers. §10: a choice of two, so the drop is a decision. */
export const RELIC_CHOICES = 2;

export function relicDefinition(id: string): RelicDefinition {
  const found = relicTable()[id];
  if (found === undefined) throw new Error(`no relic named "${id}"`);
  return found;
}

export function leversFor(held: readonly string[]): RelicLevers {
  return foldRelicAtoms(held.flatMap((id) => relicDefinition(id).atoms));
}

/**
 * Two relics the run does not already hold.
 *
 * **Always draws `RELIC_CHOICES` times**, whatever it finds, so the stream
 * position cannot depend on which relics happen to be held (docs/M1_PLAN.md
 * D32). A draw landing on something already held is re-picked from the
 * remaining pool by index rather than re-rolled, which keeps the count fixed.
 */
export function offerRelics(held: readonly string[], rng: Rng): readonly string[] {
  const pool = Object.keys(relicTable()).filter((id) => !held.includes(id));
  const offered: string[] = [];

  for (let pick = 0; pick < RELIC_CHOICES; pick += 1) {
    const remaining = pool.filter((id) => !offered.includes(id));
    const drawn = rng.nextInt(Math.max(1, remaining.length));
    const chosen = remaining[drawn];
    if (chosen !== undefined) offered.push(chosen);
  }

  return offered;
}

/** §10: a relic is permanent, and holding it twice would mean nothing. */
export function takeRelic(held: readonly string[], id: string): readonly string[] {
  return held.includes(id) ? held : [...held, id];
}
