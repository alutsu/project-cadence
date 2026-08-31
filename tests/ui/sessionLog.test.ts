import { describe, expect, it } from 'vitest';
import type { CombatEvent } from '../../src/sim/events.ts';
import { actorId, cardId } from '../../src/sim/ids.ts';
import { tick } from '../../src/sim/tick.ts';
import { SessionLog } from '../../src/ui/SessionLog.ts';

const PLAYER = actorId('player');
const RAT = actorId('rat');
const STRIKE = cardId('lunge');
const CRUSH = cardId('crush');

const EVENTS: readonly CombatEvent[] = [
  { kind: 'card_played', at: tick(6), actor: PLAYER, card: STRIKE, weight: tick(4) },
  { kind: 'damage_dealt', tag: null, at: tick(6), source: PLAYER, target: RAT, amount: 9 },
  { kind: 'staggered', at: tick(6), actor: RAT, delay: tick(3) },
  { kind: 'waited', at: tick(10), actor: PLAYER },
  { kind: 'damage_dealt', tag: null, at: tick(12), source: RAT, target: PLAYER, amount: 3 },
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

  it('counts damage over time, which lands without a blow (GDD §4.5)', () => {
    const log = new SessionLog();
    log.record(
      [
        { kind: 'damage_dealt', tag: null, at: tick(12), source: RAT, target: PLAYER, amount: 3 },
        { kind: 'status_proc', at: tick(17), actor: PLAYER, status: 'poison', amount: 4 },
        // Someone else's Poison is not the player's problem.
        { kind: 'status_proc', at: tick(17), actor: RAT, status: 'poison', amount: 9 },
      ],
      PLAYER,
    );

    expect(log.totals([]).damageTaken).toBe(7);
  });

  it('names what last hurt the player, so a death screen can say it', () => {
    const log = new SessionLog();
    expect(log.lastHarm()).toBeNull();

    log.record(
      [{ kind: 'damage_dealt', tag: null, at: tick(12), source: RAT, target: PLAYER, amount: 3 }],
      PLAYER,
    );
    expect(log.lastHarm()).toEqual({ kind: 'blow', source: RAT, amount: 3 });

    // A status finishing the job overwrites the blow that came before it.
    log.record(
      [{ kind: 'status_proc', at: tick(17), actor: PLAYER, status: 'poison', amount: 4 }],
      PLAYER,
    );
    expect(log.lastHarm()).toEqual({ kind: 'status', status: 'poison', amount: 4 });
  });

  it('starts the next attempt at the set from nothing', () => {
    const log = new SessionLog();
    log.record(EVENTS, PLAYER);
    log.encounterFinished();
    log.reset();

    const totals = log.totals([STRIKE, CRUSH]);
    expect(totals).toMatchObject({
      encounters: 0,
      cardsPlayed: 0,
      waits: 0,
      staggers: 0,
      damageTaken: 0,
    });
    expect(totals.neverPlayed).toEqual([STRIKE, CRUSH]);
    expect(log.lastHarm()).toBeNull();
  });
});
