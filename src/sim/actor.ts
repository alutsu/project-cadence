import type { ActorId } from './ids.ts';
import { effectiveSpeed } from './speed.ts';
import { speedModifier, type Status } from './status.ts';
import type { Tick } from './tick.ts';

export type Side = 'player' | 'enemy';

/**
 * What an enemy has telegraphed as its next action (GDD §4.2). The Weight is
 * part of the telegraph, which is what makes the 8-slot forecast honest.
 * Selection logic arrives with the real archetypes in S7.
 */
export interface Intent {
  readonly name: string;
  readonly weight: Tick;
  readonly damage: number;
}

export interface Actor {
  readonly id: ActorId;
  readonly name: string;
  readonly side: Side;
  /** Tie-break of last resort (GDD §4.1). Assigned once, at combat start. */
  readonly index: number;
  readonly baseSpeed: number;
  /** Signed total of Haste and Slow. Statuses that move it arrive in S5. */
  readonly speedGain: number;
  readonly hp: number;
  readonly maxHp: number;
  /** Time-shaped mitigation: absorbs damage and decays 1 per tick (GDD §4.4). */
  readonly guard: number;
  /** The single-hit threshold that staggers this actor (GDD §4.6). 0 = immune. */
  readonly poise: number;
  /** Staggers landed this encounter, for the diminishing ladder (GDD §4.6). */
  readonly staggersTaken: number;
  readonly statuses: readonly Status[];
  readonly nextActTick: Tick;
  /** The actor's own action count, for the draw rule above the soft cap (§4.7). */
  readonly actionsCommitted: number;
  readonly intent: Intent | null;
}

export function isAlive(actor: Actor): boolean {
  return actor.hp > 0;
}

/** Base Speed plus every Haste and Slow currently on the actor (GDD §4.5). */
export function actorSpeed(actor: Actor): number {
  return effectiveSpeed(actor.baseSpeed, actor.speedGain + speedModifier(actor.statuses));
}
