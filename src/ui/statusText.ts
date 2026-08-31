import type { Status } from '../sim/status.ts';

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
