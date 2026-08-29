import type { Actor } from './actor.ts';
import type { ActorId } from './ids.ts';
import { actionDelay } from './speed.ts';
import type { CombatState } from './state.ts';
import { nextToAct } from './timeline.ts';
import { addTicks, type Tick } from './tick.ts';
import { actorSpeed, isAlive } from './actor.ts';

/** GDD §4.2: the next eight turn slots render as a strip at the top of combat. */
export const QUEUE_SLOTS = 8;

export interface QueueSlot {
  readonly actor: ActorId;
  readonly at: Tick;
}

/**
 * The honest forecast (GDD §4.2). Enemy intents are telegraphed, so their next
 * Weight is known and their future slots are real.
 *
 * The player appears exactly once — at the turn they are already scheduled for.
 * Their turn after that depends on which card they choose, and the strip must
 * not invent a Weight on their behalf. Filling that gap is precisely what the
 * ghost preview does (S3): hovering a card is how the player learns where the
 * choice puts them.
 */
export function forecastQueue(
  state: CombatState,
  slots: number = QUEUE_SLOTS,
): readonly QueueSlot[] {
  const forecast: QueueSlot[] = [];
  let pool = state.actors.filter(isAlive);

  while (forecast.length < slots) {
    const acting = nextToAct(pool);
    if (acting === null) break;

    forecast.push({ actor: acting.id, at: acting.nextActTick });
    pool = pool.filter((actor) => actor.id !== acting.id);

    const projected = projectNextTurn(acting);
    if (projected !== null) pool = [...pool, projected];
  }

  return forecast;
}

/** An actor's next scheduled turn, or null when it cannot honestly be known. */
function projectNextTurn(actor: Actor): Actor | null {
  if (actor.side === 'player' || actor.intent === null) return null;

  return {
    ...actor,
    nextActTick: addTicks(actor.nextActTick, actionDelay(actor.intent.weight, actorSpeed(actor))),
  };
}
