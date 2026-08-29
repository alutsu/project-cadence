import { describe, expect, it } from 'vitest';
import type { CombatEvent } from '../../src/sim/events.ts';
import { actorId, cardId } from '../../src/sim/ids.ts';
import { tick } from '../../src/sim/tick.ts';
import { SessionLog } from '../../src/ui/SessionLog.ts';

const PLAYER = actorId('player');
const RAT = actorId('rat');
const STRIKE = cardId('strike');
const CRUSH = cardId('crush');

const EVENTS: readonly CombatEvent[] = [
  { kind: 'card_played', at: tick(6), actor: PLAYER, card: STRIKE, weight: tick(4) },
  { kind: 'damage_dealt', at: tick(6), source: PLAYER, target: RAT, amount: 9 },
  { kind: 'staggered', at: tick(6), actor: RAT, delay: tick(3) },
  { kind: 'waited', at: tick(10), actor: PLAYER },
  { kind: 'damage_dealt', at: tick(12), source: RAT, target: PLAYER, amount: 3 },
];

/** The gate asks questions a player cannot answer from memory (plan §7). */
describe('session instrumentation', () => {
  it('counts what the gate questions ask about', () => {
    const log = new SessionLog();
    log.record(EVENTS, PLAYER);

    const totals = log.totals([STRIKE, CRUSH]);
    expect(totals.cardsPlayed).toBe(1);
    expect(totals.waits).toBe(1);
    expect(totals.staggers).toBe(1);
    // Damage the player took, not damage they dealt.
    expect(totals.damageTaken).toBe(3);
  });

  it('names the cards that were never played — gate question six', () => {
    const log = new SessionLog();
    log.record(EVENTS, PLAYER);

    expect(log.totals([STRIKE, CRUSH]).neverPlayed).toEqual([CRUSH]);
  });

  it('reports nothing unplayed once every card has been used', () => {
    const log = new SessionLog();
    log.record(EVENTS, PLAYER);

    expect(log.totals([STRIKE]).neverPlayed).toEqual([]);
  });
});
