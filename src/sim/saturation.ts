import type { CombatEvent } from './events.ts';
import type { ActorId } from './ids.ts';
import { TAGS, tagTable, type Tag } from './tag.ts';

/**
 * Saturation (GDD §7.3): the always-on push away from single-solution play.
 *
 * > Tracks the tag dealing most of your damage over the last 6 encounters.
 * > +6% per encounter where one tag exceeds 50% of your damage, −5% per
 * > encounter otherwise, cap 30%.
 *
 * The arithmetic is here, in `/sim`, because it is a rule. The *memory* — which
 * six encounters — belongs to the run layer, because it outlives any one fight.
 * This module is given a history and hands back a number; it never keeps one.
 */

export const SATURATION_WINDOW = 6;
export const SATURATION_GAIN = 0.06;
export const SATURATION_DECAY = 0.05;
export const SATURATION_CAP = 0.3;
/** GDD §7.3's "most of your damage": strictly more than half of it. */
export const DOMINANCE_SHARE = 0.5;

/**
 * Which tag carried each of the last encounters, oldest first. `null` is an
 * encounter no single tag dominated — which is the state the whole mechanic is
 * trying to reward, so it is a real entry rather than an absence.
 */
export interface SaturationHistory {
  readonly recent: readonly (Tag | null)[];
}

export const NO_HISTORY: SaturationHistory = { recent: [] };

/**
 * What the player's own tagged damage added up to, by tag (GDD §7.3).
 *
 * Read off the event log rather than tracked alongside it, so the number cannot
 * drift from the game it is measuring (CLAUDE.md §2.2). Untagged damage —
 * every enemy blow, and every status tick — contributes nothing: §7.3 is about
 * what *you* are leaning on.
 */
export function attributeDamage(
  events: readonly CombatEvent[],
  player: ActorId,
): Readonly<Record<Tag, number>> {
  const totals: Record<Tag, number> = { ...tagTable(0) };

  for (const event of events) {
    if (event.kind !== 'damage_dealt' || event.source !== player || event.tag === null) continue;
    totals[event.tag] += event.amount;
  }

  return totals;
}

/** The tag that took more than half the damage, or null if none did. */
export function dominantTag(totals: Readonly<Record<Tag, number>>): Tag | null {
  const dealt = TAGS.reduce((sum, tag) => sum + totals[tag], 0);
  if (dealt <= 0) return null;

  return TAGS.find((tag) => totals[tag] / dealt > DOMINANCE_SHARE) ?? null;
}

/** The window, moved on by one encounter. Older than six is forgotten. */
export function recordEncounter(
  history: SaturationHistory,
  dominant: Tag | null,
): SaturationHistory {
  return { recent: [...history.recent, dominant].slice(-SATURATION_WINDOW) };
}

/**
 * GDD §7.3's fold. A tag climbs while it is carrying the run and decays while
 * it is not — the decay is why a build that diversifies recovers rather than
 * being punished forever for what it used to be.
 */
export function saturationOf(history: SaturationHistory): Readonly<Record<Tag, number>> {
  const levels: Record<Tag, number> = { ...tagTable(0) };

  for (const dominant of history.recent) {
    for (const tag of TAGS) {
      const moved = levels[tag] + (tag === dominant ? SATURATION_GAIN : -SATURATION_DECAY);
      levels[tag] = Math.min(SATURATION_CAP, Math.max(0, moved));
    }
  }

  return levels;
}
