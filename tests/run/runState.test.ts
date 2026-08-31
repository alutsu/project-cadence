import { describe, expect, it } from 'vitest';
import { PLAYER, RAT } from '../../src/data/encounters.ts';
import {
  absorbEncounter,
  depthOf,
  encounterSetupFor,
  maxHpFloor,
  NORMAL_BASE_XP,
  openSocket,
  SIGNATURE_CARD,
  startRun,
  weaveSnapshot,
  type EncounterResult,
  type RunState,
} from '../../src/run/RunState.ts';
import { rollAttunement, shiftAttunement } from '../../src/run/attunement.ts';
import { deckAtLevel, skillTable } from '../../src/data/skills.ts';
import {
  bankXp,
  deckSizeAtLevel,
  enemyLevel,
  MAX_HP_PER_LEVEL,
  MAX_LEVEL,
  maxHpAtLevel,
  xpAwarded,
} from '../../src/sim/level.ts';
import type { CombatEvent } from '../../src/sim/events.ts';
import { cardId, type CardId } from '../../src/sim/ids.ts';
import { createRng } from '../../src/sim/rng.ts';
import type { CombatSetup } from '../../src/sim/combat.ts';
import { depthMapAt } from '../../src/run/map.ts';
import { advanceRun, viewOf, type RunIntent, type RunView } from '../../src/run/runFlow.ts';
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
  const result: EncounterResult = { outcome: 'won', hp: run.hp, events, baseXp: NORMAL_BASE_XP };
  return absorbEncounter(run, result);
}

/**
 * A whole run walked through the flow, winning every fight (GDD §11).
 * Takes the first node offered each time, which is enough to reach the Boss and
 * therefore enough to exercise the Depth transitions §7.1 hangs its shifts on.
 */
function walkRun(seed: number, events: readonly CombatEvent[] = []): RunState {
  let run = startRun(seed);

  for (let step = 0; step < 400; step += 1) {
    const view = viewOf(run);
    if (view.kind === 'summary') break;
    run = advanceRun(run, intentFor(view, events)).run;
  }

  return run;
}

function intentFor(view: RunView, events: readonly CombatEvent[]): RunIntent {
  if (view.kind === 'map') {
    const node = view.offered[0];
    if (node === undefined) throw new Error('a Depth offered nothing');
    return { kind: 'enterNode', node: node.id };
  }
  if (view.kind === 'sanctum') return { kind: 'rest' };
  if (view.kind === 'market') return { kind: 'leaveNode' };
  return {
    kind: 'finishEncounter',
    result: { won: true, hp: 40, events, ticks: 20, hpOnEntry: 70 },
  };
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
    const walked = walkRun(3, [blow('Frost', 8)]);

    // Four draws for the opening roll, then four per shift at Depths 2 and 3.
    expect(walked.streams.weave.position).toBe(startRun(3).streams.weave.position + 8);
  });

  it('lays out the same map for the same seed, and a different one otherwise', () => {
    expect(startRun(12).map).toEqual(startRun(12).map);
    expect(startRun(12).map).not.toEqual(startRun(13).map);
  });

  it('draws the whole map at run start, so the route cannot move the stream', () => {
    // §20.2: a Depth generated on arrival would make the position depend on
    // which nodes were taken, and a resumed run would land in another world.
    expect(walkRun(19).streams.map).toEqual(startRun(19).streams.map);
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

    for (let step = 0; step < 400; step += 1) {
      const view = viewOf(run);
      if (view.kind === 'summary') break;
      run = advanceRun(run, intentFor(view, [])).run;
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

describe('the run carries a wound; the Sanctum is the rest (GDD §4.10, §11)', () => {
  it('takes the surviving HP onward — nothing heals between fights', () => {
    const run = startRun(9);
    const wounded = absorbEncounter(run, {
      outcome: 'won',
      hp: 40,
      events: [],
      baseXp: NORMAL_BASE_XP,
    });

    expect(wounded.hp).toBe(40);
  });

  it('fills the pool at a Sanctum, and never raises the pool itself (§6.1)', () => {
    // A Sanctum that restored Max HP would refund the one cost §6.1 charges.
    const run: RunState = { ...startRun(9), maxHp: 58, hp: 12 };
    const depth = depthMapAt(run.map, run.position.depth);
    const sanctum = depth.offered.find((node) => node.kind === 'sanctum');
    if (sanctum === undefined) throw new Error('the Depth offers no Sanctum');

    const entered = advanceRun(run, { kind: 'enterNode', node: sanctum.id }).run;
    const rested = advanceRun(entered, { kind: 'rest' }).run;

    expect(rested.hp).toBe(58);
    expect(rested.maxHp).toBe(58);
  });

  it('ends the run on a loss, immediately (§13)', () => {
    let run = startRun(9);
    const depth = depthMapAt(run.map, run.position.depth);
    const dungeon = depth.offered.find((node) => node.kind === 'dungeon');
    if (dungeon === undefined) throw new Error('the Depth offers no dungeon');

    run = advanceRun(run, { kind: 'enterNode', node: dungeon.id }).run;
    const dead = advanceRun(run, {
      kind: 'finishEncounter',
      result: { won: false, hp: 0, events: [], ticks: 20, hpOnEntry: 70 },
    }).run;

    expect(viewOf(dead)).toEqual({ kind: 'summary', won: false });
  });
});

/** The setup for the first fight the run walks into (GDD §11). */
function firstEncounter(run: RunState): CombatSetup {
  const depth = depthMapAt(run.map, run.position.depth);
  const dungeon = depth.offered.find((node) => node.kind === 'dungeon');
  if (dungeon === undefined) throw new Error('the Depth offers no dungeon');
  return encounterSetupFor(run, dungeon);
}

describe('what the run hands to combat', () => {
  it('gives the player the run’s own HP and Max HP', () => {
    const run: RunState = { ...startRun(4), hp: 33, maxHp: 52 };
    const player = firstEncounter(run).actors.find((actor) => actor.side === 'player');

    expect(player?.hp).toBe(33);
    expect(player?.maxHp).toBe(52);
  });

  it('hands over the Weave the run currently believes in', () => {
    const run = startRun(4);
    expect(firstEncounter(run).weave).toEqual(weaveSnapshot(run));
  });

  it('knows which Depth it is in', () => {
    expect(depthOf(startRun(1))).toBe(1);
  });

  it('states the §6.1 Max HP floor as an absolute number', () => {
    // 40% of the 70 baseline (docs/M1_PLAN.md D18).
    expect(maxHpFloor(startRun(1))).toBe(28);
  });
});

/**
 * GDD §22 Q1 candidate (b). M0 could not judge it — docs/M0_GATE.md §3 records
 * that there was no Insight system to reward — so it is built here and settled
 * at M1's gate (docs/M1_PLAN.md D25).
 */
describe('an Ultimate that kills can pay Insight (GDD §22 Q1)', () => {
  const cataclysm = cardId('cataclysm');
  const lunge = cardId('lunge');

  function killWith(card: CardId): readonly CombatEvent[] {
    return [
      { kind: 'card_played', at: tick(1), actor: PLAYER, card, weight: tick(16) },
      { kind: 'actor_died', at: tick(1), actor: RAT },
    ];
  }

  it('pays nothing under the rules that do not promise it', () => {
    const run = startRun(2);
    expect(
      absorbEncounter(run, {
        outcome: 'won',
        hp: 50,
        events: killWith(cataclysm),
        baseXp: NORMAL_BASE_XP,
      }).insight,
    ).toBe(run.insight);
  });

  it('pays for a kill the Ultimate landed', () => {
    const run: RunState = { ...startRun(2), rules: { ...startRun(2).rules, ultimate: 'insight' } };
    const after = absorbEncounter(run, {
      outcome: 'won',
      hp: 50,
      events: killWith(cataclysm),
      baseXp: NORMAL_BASE_XP,
    });

    expect(after.insight).toBe(run.insight + 1);
  });

  it('pays nothing for a kill any other card landed', () => {
    const run: RunState = { ...startRun(2), rules: { ...startRun(2).rules, ultimate: 'insight' } };
    const after = absorbEncounter(run, {
      outcome: 'won',
      hp: 50,
      events: killWith(lunge),
      baseXp: NORMAL_BASE_XP,
    });

    expect(after.insight).toBe(run.insight);
  });
});

/**
 * GDD §5.1–5.3. The published table is the contract: a level grants a skill and
 * +6 Max HP, and the deck is a *function* of the level rather than a list that
 * accumulates — so it can be re-derived rather than maintained.
 */
describe('levels, XP and Threat (GDD §5.1–5.3)', () => {
  it('matches §5.1s published Max HP column exactly', () => {
    expect(maxHpAtLevel(1)).toBe(70);
    expect(maxHpAtLevel(12)).toBe(136);
    expect(deckSizeAtLevel(1)).toBe(5);
    expect(deckSizeAtLevel(12)).toBe(16);
  });

  it('grants the deck the level says, in the authored order (§5.1)', () => {
    const table = skillTable();
    expect(deckAtLevel(table, 1)).toHaveLength(5);
    expect(deckAtLevel(table, 12)).toHaveLength(16);
    // Level N grants skill N in order, so a level's deck is a prefix of the next.
    expect(deckAtLevel(table, 6).slice(0, deckSizeAtLevel(5))).toEqual(deckAtLevel(table, 5));
  });

  it('opens the run with the signature in hand, per §6.1', () => {
    expect(deckAtLevel(skillTable(), 1)).toContain(SIGNATURE_CARD);
  });

  it('applies §5.2s clamp at both ends', () => {
    const base = 100;
    // Far below your level pays the 0.10 floor; far above pays the 1.80 cap.
    expect(xpAwarded({ baseXp: base, enemyLevel: 0, playerLevel: 40 })).toBe(10);
    expect(xpAwarded({ baseXp: base, enemyLevel: 40, playerLevel: 0 })).toBe(180);
    expect(xpAwarded({ baseXp: base, enemyLevel: 3, playerLevel: 3 })).toBe(100);
  });

  it('never skips a level, however much XP arrives at once (§5.1)', () => {
    // A level hands over a skill, so two levels cannot arrive as one.
    const jumped = bankXp({ level: 1, xp: 0 }, 10_000);
    expect(jumped.level).toBe(MAX_LEVEL);
  });

  it('grows Max HP and the §6.1 baseline together, without refunding a socket', () => {
    const run = startRun(31);
    const socketed = openSocket(run, SIGNATURE_CARD);
    if (!socketed.ok) throw new Error(socketed.reason);
    expect(run.maxHp - socketed.run.maxHp).toBeGreaterThan(0);

    // Cleared until at least one level has landed — the point is what a level
    // does to a pool that has already been spent from, not how fast it arrives.
    let levelled = socketed.run;
    while (levelled.level === socketed.run.level) levelled = clear(levelled, []);
    const gained = (levelled.level - socketed.run.level) * MAX_HP_PER_LEVEL;

    // §5.1 [FIX]: the gain widens the pool, and the HP already spent on a
    // socket stays spent — a level must never refund one (§6.1).
    expect(levelled.maxHp).toBe(socketed.run.maxHp + gained);
    expect(levelled.maxHp).toBeLessThan(maxHpAtLevel(levelled.level));
    expect(levelled.baselineMaxHp).toBe(run.baselineMaxHp + gained);
    expect(maxHpFloor(levelled)).toBeGreaterThan(maxHpFloor(run));
  });

  it('raises Threat per node entered, so enemies climb to meet you (§5.3)', () => {
    const run = startRun(31);
    const depth = depthMapAt(run.map, run.position.depth);
    const dungeon = depth.offered.find((node) => node.kind === 'dungeon');
    const sanctum = depth.offered.find((node) => node.kind === 'sanctum');
    if (dungeon === undefined || sanctum === undefined) throw new Error('Depth is malformed');

    // A Dungeon raises it; a rest costs a node instead (§11).
    expect(advanceRun(run, { kind: 'enterNode', node: dungeon.id }).run.threat).toBe(
      run.threat + 1,
    );
    expect(advanceRun(run, { kind: 'enterNode', node: sanctum.id }).run.threat).toBe(run.threat);
    // enemy_level = depth_base + floor(Threat / 2)
    expect(enemyLevel(0, 0)).toBe(0);
    expect(enemyLevel(0, 3)).toBe(1);
    expect(enemyLevel(2, 5)).toBe(4);
  });
});
