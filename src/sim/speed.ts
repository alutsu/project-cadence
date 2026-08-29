import { type Tick, tick } from './tick.ts';

/**
 * Speed, delay and the diminishing-returns curve (GDD §4.1, §4.7).
 *
 * Speed is the player's axis: it buys turn frequency, and above the soft cap it
 * buys progressively less, because three multiplicative benefits on one stat is
 * the runaway v0.1 shipped by accident.
 */
export const BASE_SPEED = 100;
export const SPEED_SOFT_CAP = 140;
export const SPEED_HARD_CAP = 180;

/**
 * A floor is required and the GDD does not give one: without it a large enough
 * Slow drives effective Speed to zero and the delay formula divides by it.
 * 20 is one fifth of base — punishing, still playable, never degenerate.
 */
export const MIN_EFFECTIVE_SPEED = 20;

/** Ticks the timeline is seeded from at combat start (GDD §4.1). */
export const COMBAT_SEED_CONSTANT = 600;

/** The Weight the delay formula is normalised against (GDD §4.1). */
const DELAY_REFERENCE_SPEED = 100;

/**
 * GDD §4.7. Gain is the signed total of Haste and Slow. Written against a base
 * of 100 in the GDD; generalised here so enemies (base 70–130, §12.2) share one
 * function, which is exact for base 100 and sensible for the rest.
 */
export function effectiveSpeed(baseSpeed: number, gain: number): number {
  const raw = baseSpeed + gain;
  const damped = raw <= SPEED_SOFT_CAP ? raw : SPEED_SOFT_CAP + (raw - SPEED_SOFT_CAP) / 2;
  return Math.min(Math.max(damped, MIN_EFFECTIVE_SPEED), SPEED_HARD_CAP);
}

/** GDD §4.1: `delay = ceil(weight * 100 / effective_speed)`. */
export function actionDelay(weight: Tick, speed: number): Tick {
  if (speed <= 0)
    throw new RangeError(`effective speed must be positive, received ${String(speed)}`);
  return tick(Math.ceil((weight * DELAY_REFERENCE_SPEED) / speed));
}

/**
 * GDD §4.1: every actor is seeded at `ceil(600 / speed)`, so the faster actor
 * simply acts first. No coin flip at combat start.
 */
export function combatSeedTick(speed: number): Tick {
  if (speed <= 0) throw new RangeError(`speed must be positive, received ${String(speed)}`);
  return tick(Math.ceil(COMBAT_SEED_CONSTANT / speed));
}

/**
 * GDD §4.7 [AMD]: above the soft cap, extra actions still accrue but extra cards
 * do not. "Every other turn" counts the actor's own committed actions — there is
 * no shared turn counter in this game and none may be introduced (P6).
 */
export function drawsOnAction(speed: number, actionsCommitted: number): boolean {
  if (speed <= SPEED_SOFT_CAP) return true;
  return actionsCommitted % 2 === 0;
}
