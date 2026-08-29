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
