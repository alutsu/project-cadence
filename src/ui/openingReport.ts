import type { CombatEvent } from '../sim/events.ts';
import type { ActorId } from '../sim/ids.ts';
import { findActor, type CombatState } from '../sim/state.ts';

/**
 * What happened to the player before they were first allowed to act.
 *
 * GDD §4.1 seeds every actor at `ceil(600 / speed)`, so anything faster than
 * the player takes a turn before the encounter is ever shown. That is the
 * design working — but the queue strip only shows the future, so the opening
 * blow arrives as an unexplained dent in the HP bar and reads like a bug
 * carried over from the last fight. This is the missing past tense.
 *
 * Returns null when nothing touched the player, which is the common case for a
 * slow enemy and means no line is drawn at all (P5).
 */
export function openingReport(state: CombatState, events: readonly CombatEvent[]): string | null {
  const blows = new Map<ActorId, number>();
  const statuses: string[] = [];

  for (const event of events) {
    if (event.kind === 'damage_dealt' && event.target === playerId(state)) {
      blows.set(event.source, (blows.get(event.source) ?? 0) + event.amount);
    }
    if (event.kind === 'status_applied' && event.actor === playerId(state)) {
      statuses.push(event.status);
    }
  }

  if (blows.size === 0 && statuses.length === 0) return null;

  const struck = [...blows].map(([actor, amount]) => {
    const name = findActor(state, actor)?.name ?? 'something';
    return `${name} for ${String(amount)}`;
  });

  const parts = [struck.join(', '), statuses.length === 0 ? '' : `you are ${statuses.join(', ')}`]
    .filter((part) => part.length > 0)
    .join('  ·  ');

  return `before your first turn — ${parts}`;
}

function playerId(state: CombatState): ActorId | null {
  return state.actors.find((actor) => actor.side === 'player')?.id ?? null;
}
