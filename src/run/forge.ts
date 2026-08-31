import { frameTable, rangeAt, type FrameRoll } from '../data/frames.ts';
import type { Frame, Gem, GemEffect, GemTier } from '../sim/gem.ts';
import { gemId, type GemId } from '../sim/ids.ts';
import type { Rng } from '../sim/rng.ts';
import { TAGS, type Tag } from '../sim/tag.ts';

/**
 * Generative crafting (GDD §6.2).
 *
 * > Spend materials → material rarity sets Tier (1–4) → choose a Frame →
 * > values roll → spend 1 Insight to reroll values (not the Frame).
 *
 * The player picks the *shape* and the run picks the *numbers*. That split is
 * the whole anti-meta argument in §6.3: gems are rolled, so the answer cannot
 * be a list. It also means every roll here consumes the `gemRoll` stream and
 * nothing else — combat's shuffle must never move because someone crafted.
 */

/** GDD §22 Q4 calls this a guess, so it is a knob rather than a constant. */
export const REROLL_INSIGHT_COST = 1;

/** Atoms whose parameter is a tag rather than a magnitude (KINDLE's). */
const TAG_ATOMS: readonly string[] = ['CONVERT_TAG'];

/**
 * Rolls inside a range, inclusive, and **always draws exactly once** — the
 * fixed-draw rule that keeps a stream position independent of its own outcome
 * (docs/M1_PLAN.md D32).
 *
 * Integer atoms round; fractional ones keep two decimals, because a damage
 * multiplier of −0.3271 is a number no player can hold in their head, and P3
 * asks them to read these values rather than merely be subject to them.
 */
function rollValue(roll: FrameRoll, tier: GemTier, rng: Rng): number {
  const { low, high } = rangeAt(roll, tier);
  const drawn = low + rng.nextFloat() * (high - low);

  return Number.isInteger(low) && Number.isInteger(high)
    ? Math.round(drawn)
    : Math.round(drawn * 100) / 100;
}

function rollTag(rng: Rng): Tag {
  return TAGS[rng.nextInt(TAGS.length)] ?? 'Physical';
}

/** Every atom the frame names, each rolled at this tier (GDD §6.2). */
function rollEffects(frame: Frame, tier: GemTier, rng: Rng): readonly GemEffect[] {
  const recipe = frameTable()[frame];
  if (recipe === undefined) throw new Error(`no recipe for frame "${frame}"`);

  return recipe.rolls.map((roll) => ({
    type: roll.type,
    value: rollValue(roll, tier, rng),
    tag: TAG_ATOMS.includes(roll.type) ? rollTag(rng) : null,
  }));
}

export interface CraftOrder {
  readonly frame: Frame;
  readonly tier: GemTier;
  /** Distinguishes this gem from every other, and survives a save. */
  readonly serial: number;
}

/**
 * A gem, rolled. The Weight rider is folded out of the frame's own
 * WEIGHT_DELTA atom rather than rolled twice: §6.2's example carries the rider
 * at the top level of the gem, so that is where it ends up.
 */
export function craftGem(order: CraftOrder, rng: Rng): Gem {
  const rolled = rollEffects(order.frame, order.tier, rng);
  const weight = rolled.find((effect) => effect.type === 'WEIGHT_DELTA');

  return {
    id: gemId(`${order.frame.toLowerCase()}_${String(order.serial)}`),
    frame: order.frame,
    tier: order.tier,
    words: [],
    weightDelta: weight?.value ?? 0,
    effects: rolled.filter((effect) => effect.type !== 'WEIGHT_DELTA'),
    affixes: [],
  };
}

/**
 * GDD §6.2: "spend 1 Insight to reroll values (**not** the Frame)".
 *
 * The frame, tier and identity all survive — you are re-rolling the numbers on
 * a thing you already chose. Rerolling the frame too would make Insight a way
 * to buy the gem you wanted, which is the deterministic-crafting collapse §22
 * Q4 is worried about.
 */
export function rerollValues(gem: Gem, rng: Rng): Gem {
  const rolled = rollEffects(gem.frame, gem.tier, rng);
  const weight = rolled.find((effect) => effect.type === 'WEIGHT_DELTA');

  return {
    ...gem,
    weightDelta: weight?.value ?? 0,
    effects: rolled.filter((effect) => effect.type !== 'WEIGHT_DELTA'),
  };
}

export function gemIdOf(frame: Frame, serial: number): GemId {
  return gemId(`${frame.toLowerCase()}_${String(serial)}`);
}
