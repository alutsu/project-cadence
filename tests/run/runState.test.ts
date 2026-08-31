import { describe, expect, it } from 'vitest';
import { PLAYER } from '../../src/data/encounters.ts';
import {
  absorbEncounter,
  depthOf,
  encounterSetup,
  maxHpFloor,
  startRun,
  weaveSnapshot,
  type EncounterResult,
  type RunState,
} from '../../src/run/RunState.ts';
import { rollAttunement, shiftAttunement } from '../../src/run/attunement.ts';
import type { CombatEvent } from '../../src/sim/events.ts';
import { createRng } from '../../src/sim/rng.ts';
import { SATURATION_CAP, saturationOf } from '../../src/sim/saturation.ts';
import { TAGS, type Tag } from '../../src/sim/tag.ts';
import { tick } from '../../src/sim/tick.ts';

/**
 * The run layer (GDD §7.1, §7.3, §4.10). What is asserted here is mostly
 * *reproducibility*: a seed has to mean the same run twice, or seed replay
 * (§13) and the balance harness (§19) are both built on sand.
 */

function blow(tag: Tag, amount: number): CombatEvent {
  return {
    kind: 'damage_dealt',
    at: tick(1),
    source: PLAYER,
    target: PLAYER,
    amount,
    tag,
  };
}

function clear(run: RunState, events: readonly CombatEvent[]): RunState {
  const result: EncounterResult = { outcome: 'won', hp: run.hp, events };
  return absorbEncounter(run, result);
}

describe('a seed means the same run twice (GDD §20.2, §13)', () => {
  it('rolls the same Attunement', () => {
    expect(startRun(7).attunement).toEqual(startRun(7).attunement);
    expect(startRun(7).attunement).not.toEqual(startRun(8).attunement);
  });

  it('reaches the same Attunement after the same encounters', () => {
    const play = (seed: number): RunState => {
      let run = startRun(seed);
      for (let fight = 0; fight < 4; fight += 1) run = clear(run, [blow('Fire', 10)]);
      return run;
    };

    expect(play(11).attunement).toEqual(play(11).attunement);
    expect(play(11).streams.weave.position).toBe(play(11).streams.weave.position);
  });

  it('leaves the weave stream at a fixed position for a fixed seed', () => {
    // docs/M1_PLAN.md D32: a shift draws a fixed number of times whatever it
    // picks. A position that depended on the outcome could not be resumed.
    let run = startRun(3);
    for (let fight = 0; fight < 6; fight += 1) run = clear(run, [blow('Frost', 8)]);

    expect(run.streams.weave.position).toBe(startRun(3).streams.weave.position + 8);
  });
});

describe('the Attunement roll (GDD §7.1)', () => {
  it('raises exactly two tags and pushes exactly two down', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const table = rollAttunement(createRng(seed, 'weave'));
      const standing = TAGS.map((tag) => table[tag]);

      expect(standing.filter((entry) => entry === 'ascendant')).toHaveLength(2);
      expect(standing.filter((entry) => entry === 'suppressed')).toHaveLength(2);
      expect(standing.filter((entry) => entry === 'neutral')).toHaveLength(2);
    }
  });

  it('keeps that shape through a shift, so the deck never all moves at once', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const rng = createRng(seed, 'weave');
      const shifted = shiftAttunement(rng, rollAttunement(rng));
      const standing = TAGS.map((tag) => shifted[tag]);

      expect(standing.filter((entry) => entry === 'ascendant')).toHaveLength(2);
      expect(standing.filter((entry) => entry === 'suppressed')).toHaveLength(2);
    }
  });

  it('shifts twice in a run and no more — at Depths 2 and 3 (§7.1)', () => {
    let run = startRun(21);
    const seen = [run.attunement];

    for (let fight = 0; fight < 6; fight += 1) {
      run = clear(run, [blow('Storm', 5)]);
      seen.push(run.attunement);
    }

    const changes = seen.filter((table, at) => at > 0 && table !== seen[at - 1]).length;
    expect(changes).toBe(2);
  });
});

describe('Saturation follows the damage, not the intent (GDD §7.3)', () => {
  it('climbs to the 30% cap for a run that leans on one tag', () => {
    let run = startRun(5);
    for (let fight = 0; fight < 6; fight += 1) run = clear(run, [blow('Fire', 30)]);

    expect(saturationOf(run.saturation).Fire).toBeCloseTo(SATURATION_CAP, 10);
    expect(weaveSnapshot(run).saturation.Fire).toBeCloseTo(SATURATION_CAP, 10);
  });

  it('stays at zero for a run that spreads its damage', () => {
    let run = startRun(5);
    for (let fight = 0; fight < 6; fight += 1) {
      run = clear(run, [blow('Fire', 10), blow('Frost', 10), blow('Storm', 10)]);
    }

    for (const tag of TAGS) expect(saturationOf(run.saturation)[tag]).toBe(0);
  });

  it('decays once the build stops leaning, so diversifying recovers', () => {
    let run = startRun(5);
    for (let fight = 0; fight < 6; fight += 1) run = clear(run, [blow('Fire', 30)]);
    const peak = saturationOf(run.saturation).Fire;

    for (let fight = 0; fight < 3; fight += 1) {
      run = clear(run, [blow('Frost', 10), blow('Storm', 10)]);
    }

    expect(saturationOf(run.saturation).Fire).toBeLessThan(peak);
  });

  it('remembers only the last six encounters', () => {
    let run = startRun(5);
    for (let fight = 0; fight < 20; fight += 1) run = clear(run, [blow('Shadow', 12)]);

    expect(run.saturation.recent).toHaveLength(6);
  });

  it('ignores damage that was not the player’s', () => {
    let run = startRun(5);
    const enemyBlow: CombatEvent = {
      kind: 'damage_dealt',
      at: tick(1),
      source: PLAYER,
      target: PLAYER,
      amount: 40,
      tag: null,
    };
    for (let fight = 0; fight < 6; fight += 1) run = clear(run, [enemyBlow]);

    for (const tag of TAGS) expect(saturationOf(run.saturation)[tag]).toBe(0);
  });
});

describe('the run carries a wound, and rests between chains (GDD §4.10)', () => {
  it('takes the surviving HP into the next fight of a chain', () => {
    const run = startRun(9);
    const wounded = absorbEncounter(run, { outcome: 'won', hp: 40, events: [] });

    expect(wounded.hp).toBe(40);
  });

  it('restores to Max HP at a chain boundary, not to the baseline', () => {
    const run: RunState = { ...startRun(9), maxHp: 58, hp: 12 };
    const first = absorbEncounter(run, { outcome: 'won', hp: 12, events: [] });
    const second = absorbEncounter(first, { outcome: 'won', hp: 8, events: [] });

    expect(second.hp).toBe(58);
  });

  it('does not advance a run that was lost', () => {
    const run = startRun(9);
    expect(absorbEncounter(run, { outcome: 'lost', hp: 0, events: [] })).toBe(run);
  });
});

describe('what the run hands to combat', () => {
  it('gives the player the run’s own HP and Max HP', () => {
    const run: RunState = { ...startRun(4), hp: 33, maxHp: 52 };
    const player = encounterSetup(run).actors.find((actor) => actor.side === 'player');

    expect(player?.hp).toBe(33);
    expect(player?.maxHp).toBe(52);
  });

  it('hands over the Weave the run currently believes in', () => {
    const run = startRun(4);
    expect(encounterSetup(run).weave).toEqual(weaveSnapshot(run));
  });

  it('knows which Depth it is in', () => {
    expect(depthOf(startRun(1))).toBe(1);
    expect(depthOf({ ...startRun(1), encounterIndex: 2 })).toBe(2);
    expect(depthOf({ ...startRun(1), encounterIndex: 5 })).toBe(3);
  });

  it('states the §6.1 Max HP floor as an absolute number', () => {
    // 40% of the 70 baseline (docs/M1_PLAN.md D18).
    expect(maxHpFloor(startRun(1))).toBe(28);
  });
});
