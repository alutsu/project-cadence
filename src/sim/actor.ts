import type { ActorId } from './ids.ts';
import { effectiveSpeed } from './speed.ts';
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
  readonly nextActTick: Tick;
  /** The actor's own action count, for the draw rule above the soft cap (§4.7). */
  readonly actionsCommitted: number;
  readonly intent: Intent | null;
}

export function isAlive(actor: Actor): boolean {
  return actor.hp > 0;
}

export function actorSpeed(actor: Actor): number {
  return effectiveSpeed(actor.baseSpeed, actor.speedGain);
}
