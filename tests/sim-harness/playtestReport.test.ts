import { describe, expect, it } from 'vitest';
import { playtestReport } from '../../src/sim-harness/playtestReport.ts';
import type { EncounterRecord, PlaytestEvent } from '../../src/run/telemetry.ts';

/**
 * The playtest report (GDD §19).
 *
 * It exists because the harness policies are a *relative* instrument
 * (docs/M2_PLAN.md D35a) — they called S1 a regression when a human found it
 * fine. What is asserted here is that the report says what the log says and
 * infers nothing, and that §19's red flags actually fire.
 */

function fight(over: Partial<EncounterRecord> = {}): EncounterRecord {
  return {
    depth: 1,
    node: 'd1n0',
    won: true,
    ticks: 40,
    decisions: 6,
    hpBefore: 70,
    hpAfter: 60,
    enemies: ['Poison Rat'],
    cardsPlayed: { lunge: 3, jab: 3 },
    damageByTag: { Physical: 30 },
    dominantTag: 'Physical',
    staggers: 2,
    guardAbsorbed: 4,
    damageTaken: 10,
    killedBy: null,
    ...over,
  };
}

function ended(record: EncounterRecord): PlaytestEvent {
  return { kind: 'encounter_ended', encounter: record };
}

describe('the report reads a session back (GDD §19)', () => {
  it('says so plainly when nothing was fought', () => {
    expect(playtestReport([{ kind: 'run_started', seed: 1, attunement: {} }])).toContain(
      'no encounters',
    );
  });

  it('names the fights, their length and what they cost', () => {
    const report = playtestReport([ended(fight())]);

    expect(report).toContain('Poison Rat');
    expect(report).toContain('40t');
    expect(report).toContain('1 fights');
  });

  it('flags a fight-length spread over 2x — §19 names it a red flag', () => {
    const report = playtestReport([ended(fight({ ticks: 20 })), ended(fight({ ticks: 90 }))]);

    expect(report).toContain('varies more than 2x');
  });

  it('does not flag a spread inside 2x', () => {
    const report = playtestReport([ended(fight({ ticks: 40 })), ended(fight({ ticks: 60 }))]);

    expect(report).not.toContain('varies more than 2x');
  });

  it('flags a card played in under 5% of turns — §19s other red flag', () => {
    const report = playtestReport([ended(fight({ cardsPlayed: { lunge: 40, cataclysm: 1 } }))]);

    expect(report).toContain('barely played');
    expect(report).toContain('cataclysm');
  });

  it('names what killed the run, and the HP it was entered on (§13)', () => {
    const report = playtestReport([
      ended(fight({ won: false, killedBy: 'Chime Adept', hpBefore: 12, depth: 2 })),
    ]);

    expect(report).toContain('died at depth 2');
    expect(report).toContain('Chime Adept');
    expect(report).toContain('12 HP entering');
  });

  it('flags Guard absorbing nothing — M0s gate question 4, still live', () => {
    const report = playtestReport([
      ended(fight({ guardAbsorbed: 0 })),
      ended(fight({ guardAbsorbed: 0 })),
    ]);

    expect(report).toContain('Guard absorbed nothing in 2 of 2');
  });

  it('flags a run where nothing was staggered', () => {
    const report = playtestReport([ended(fight({ staggers: 0 })), ended(fight({ staggers: 0 }))]);

    expect(report).toContain('nothing was staggered in 2 of 2');
  });

  it('reports the build and the cards never played (§13, §19)', () => {
    const report = playtestReport([
      ended(fight()),
      {
        kind: 'run_ended',
        summary: {
          seed: 6,
          won: false,
          depthReached: 2,
          threat: 5,
          level: 3,
          hp: 0,
          maxHp: 64,
          build: { cleave: ['WARD'], lunge: [] },
          cardsNeverPlayed: ['hammerfall'],
          saturation: ['Physical', null],
        },
      },
    ]);

    expect(report).toContain('RUN ENDED at depth 2');
    expect(report).toContain('cleave[WARD]');
    expect(report).toContain('never played: hammerfall');
  });
});
