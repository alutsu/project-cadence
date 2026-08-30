import type { CombatEvent } from '../sim/events.ts';
import type { ActorId, CardId } from '../sim/ids.ts';
import type { StatusKind } from '../sim/status.ts';

/**
 * The last thing that hurt the player. A death screen that cannot name what
 * killed you teaches nothing (GDD §13), and the two ways to die read very
 * differently: a telegraphed swing you mistimed, or a status you let run.
 */
export type Harm =
  | { readonly kind: 'blow'; readonly source: ActorId; readonly amount: number }
  | { readonly kind: 'status'; readonly status: StatusKind; readonly amount: number };

/**
 * Gate instrumentation (docs/M0_PLAN.md §7). The gate asks questions a player
 * cannot answer from memory — "which card did you never play?", "did you Wait
 * deliberately?" — so the session counts them while they play.
 *
 * Totals are scoped to the current attempt at the set and reset on death, so
 * they can be read alongside "fell on fight 3 of 6" without the two meaning
 * different spans of time.
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
  private harm: Harm | null = null;
  private readonly played = new Map<CardId, number>();

  record(events: readonly CombatEvent[], player: string): void {
    for (const event of events) this.recordOne(event, player);
  }

  encounterFinished(): void {
    this.encounters += 1;
  }

  /** Starts a fresh attempt at the set; see SessionTotals for why. */
  reset(): void {
    this.encounters = 0;
    this.waits = 0;
    this.staggers = 0;
    this.damageTaken = 0;
    this.harm = null;
    this.played.clear();
  }

  /** What last damaged the player, or null if nothing has yet. */
  lastHarm(): Harm | null {
    return this.harm;
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
      this.harm = { kind: 'blow', source: event.source, amount: event.amount };
      return;
    }
    // Poison, Bleed and Burn resolve on the timeline and never emit a blow
    // (GDD §4.5), so damage taken missed them entirely until now — and a death
    // by Poison would have shown an untouched player.
    if (event.kind === 'status_proc' && event.actor === player) {
      this.damageTaken += event.amount;
      this.harm = { kind: 'status', status: event.status, amount: event.amount };
    }
  }
}
