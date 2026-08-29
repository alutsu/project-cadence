/**
 * The one unit of game time (GDD §2, P6). Weight, Recovery, status durations,
 * Guard decay and the queue itself are all measured in ticks — never in turns,
 * rounds, seconds or milliseconds, because turns are asynchronous and per-actor.
 */
export type Tick = number & { readonly __brand: 'Tick' };

/** The only sanctioned place the Tick brand is applied (CLAUDE.md §3.1). */
export function tick(value: number): Tick {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`Tick must be a non-negative integer, received ${String(value)}`);
  }
  return value as Tick;
}

export const TICK_ZERO: Tick = tick(0);

export function addTicks(a: Tick, b: Tick): Tick {
  return tick(a + b);
}

/** Signed distance from `from` to `to`, in ticks. */
export function ticksBetween(from: Tick, to: Tick): number {
  return to - from;
}
