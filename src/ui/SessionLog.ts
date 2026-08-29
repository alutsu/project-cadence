import type { CombatEvent } from '../sim/events.ts';
import type { CardId } from '../sim/ids.ts';

/**
 * Gate instrumentation (docs/M0_PLAN.md §7). The gate asks questions a player
 * cannot answer from memory — "which card did you never play?", "did you Wait
 * deliberately?" — so the session counts them while they play.
 */
export interface SessionTotals {
  readonly encounters: number;
  readonly cardsPlayed: number;
  readonly waits: number;
  readonly staggers: number;
  readonly damageTaken: number;
  readonly neverPlayed: readonly CardId[];
}

export class SessionLog {
  private encounters = 0;
  private waits = 0;
  private staggers = 0;
  private damageTaken = 0;
  private readonly played = new Map<CardId, number>();

  record(events: readonly CombatEvent[], player: string): void {
    for (const event of events) this.recordOne(event, player);
  }

  encounterFinished(): void {
    this.encounters += 1;
  }

  totals(deck: readonly CardId[]): SessionTotals {
    return {
      encounters: this.encounters,
      cardsPlayed: [...this.played.values()].reduce((sum, count) => sum + count, 0),
      waits: this.waits,
      staggers: this.staggers,
      damageTaken: this.damageTaken,
      neverPlayed: [...new Set(deck)].filter((card) => !this.played.has(card)),
    };
  }

  private recordOne(event: CombatEvent, player: string): void {
    if (event.kind === 'card_played') {
      this.played.set(event.card, (this.played.get(event.card) ?? 0) + 1);
      return;
    }
    if (event.kind === 'waited') this.waits += 1;
    if (event.kind === 'staggered') this.staggers += 1;
    if (event.kind === 'damage_dealt' && event.target === player) {
      this.damageTaken += event.amount;
    }
  }
}
