import type { Tick } from './tick.ts';

/**
 * Status effects (GDD §4.5). Every duration is in ticks, never in turns — turns
 * are asynchronous and per-actor, so a "two turn" buff has no meaning here
 * (GDD §2, P6).
 */
export type StatusKind =
  'poison' | 'burn' | 'bleed' | 'slow' | 'haste' | 'weaken' | 'empower' | 'brittle';

export interface Status {
  readonly kind: StatusKind;
  readonly magnitude: number;
  /** Tick the status ends on, or null when it ends by running out of magnitude. */
  readonly expiresAt: Tick | null;
  /** Next tick this status deals damage, for the periodic ones. */
  readonly nextProcAt: Tick | null;
}

/** GDD §4.5: Poison and Burn both tick on a fixed five-tick clock. */
export const POISON_INTERVAL = 5;
export const BURN_INTERVAL = 5;
export const BURN_DURATION = 20;

/** Poison ignores Guard (GDD §4.5); Burn and Bleed do not. */
export function ignoresGuard(kind: StatusKind): boolean {
  return kind === 'poison';
}

export function isPeriodic(kind: StatusKind): boolean {
  return kind === 'poison' || kind === 'burn';
}

export function speedModifier(statuses: readonly Status[]): number {
  return statuses.reduce((total, status) => {
    if (status.kind === 'slow') return total - status.magnitude;
    if (status.kind === 'haste') return total + status.magnitude;
    return total;
  }, 0);
}

/** Weaken and Empower scale damage dealt (GDD §4.5). */
export function damageScale(statuses: readonly Status[]): number {
  return statuses.reduce((scale, status) => {
    if (status.kind === 'weaken') return scale * (1 - status.magnitude);
    if (status.kind === 'empower') return scale * (1 + status.magnitude);
    return scale;
  }, 1);
}

export function magnitudeOf(statuses: readonly Status[], kind: StatusKind): number {
  return statuses
    .filter((status) => status.kind === kind)
    .reduce((total, status) => total + status.magnitude, 0);
}
