import type { CombatEvent } from '../sim/events.ts';

/**
 * One event as one line. Shared by the CLI and by the determinism golden test,
 * so what a human reads and what CI asserts are the same text.
 */
export function formatEvent(event: CombatEvent): string {
  const at = `t${String(event.at)}`;
  switch (event.kind) {
    case 'combat_started':
      return `${at} combat_started`;
    case 'actor_scheduled':
      return `${at} scheduled ${event.actor} -> t${String(event.nextActTick)}`;
    case 'turn_started':
      return `${at} turn ${event.actor}`;
    case 'card_played':
      return `${at} played ${event.actor} ${event.card} w${String(event.weight)}`;
    case 'waited':
      return `${at} waited ${event.actor}`;
    case 'card_drawn':
      return `${at} drew ${event.card}`;
    case 'draw_skipped':
      return `${at} no draw (${event.reason})`;
    case 'card_cooled':
      return `${at} cooldown ${event.card} -> t${String(event.returnTick)}`;
    case 'card_returned':
      return `${at} returned ${event.card}`;
    case 'guard_gained':
      return `${at} guard ${event.actor} +${String(event.amount)}`;
    case 'guard_absorbed':
      return `${at} guard ${event.actor} absorbed ${String(event.amount)}`;
    case 'status_applied':
      return `${at} ${event.status} ${event.actor} ${String(event.magnitude)}`;
    case 'status_proc':
      return `${at} ${event.status} ${event.actor} ticks ${String(event.amount)}`;
    case 'status_expired':
      return `${at} ${event.status} ${event.actor} ends`;
    case 'intent_executed':
      return `${at} intent ${event.actor} ${event.intent}`;
    case 'damage_dealt':
      return `${at} damage ${event.source} -> ${event.target} ${String(event.amount)}`;
    case 'actor_died':
      return `${at} died ${event.actor}`;
    case 'combat_ended':
      return `${at} combat_ended ${event.outcome}`;
  }
}
