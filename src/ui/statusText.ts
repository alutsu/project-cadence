import type { Status } from '../sim/status.ts';
import type { Tick } from '../sim/tick.ts';

/**
 * Statuses as one short line. Durations are shown as the tick they end on, so
 * they can be read straight off the queue strip rather than counted in the head
 * (GDD §15).
 */
export function describeStatuses(statuses: readonly Status[]): string {
  return statuses.map(describe).join('  ·  ');
}

function describe(status: Status): string {
  const magnitude = String(status.magnitude);
  const until = status.expiresAt === null ? '' : ` →t${String(status.expiresAt)}`;
  return `${status.kind} ${magnitude}${until}`;
}

/** The tick Guard runs out on, if nothing hits it first (GDD §4.4). */
export function guardHoldsUntil(guard: number, now: Tick): number {
  return now + guard;
}
