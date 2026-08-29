import { describe, expect, it } from 'vitest';
import type { Actor } from '../../src/sim/actor.ts';
import { actorId } from '../../src/sim/ids.ts';
import { nextToAct } from '../../src/sim/timeline.ts';
import { tick } from '../../src/sim/tick.ts';

interface ActorSpec {
  readonly name: string;
  readonly at: number;
  readonly baseSpeed: number;
  readonly index: number;
}

function actor(spec: ActorSpec): Actor {
  const { name, at, baseSpeed, index } = spec;
  return {
    id: actorId(name),
    name,
    side: 'enemy',
    index,
    baseSpeed,
    speedGain: 0,
    hp: 10,
    maxHp: 10,
    guard: 0,
    poise: 0,
    staggersTaken: 0,
    statuses: [],
    nextActTick: tick(at),
    actionsCommitted: 0,
    intents: [],
    intentIndex: 0,
  };
}

describe('turn order (GDD §4.1)', () => {
  it('picks the lowest next_act_tick', () => {
    const actors = [
      actor({ name: 'slow', at: 9, baseSpeed: 100, index: 0 }),
      actor({ name: 'soon', at: 4, baseSpeed: 70, index: 1 }),
    ];
    expect(nextToAct(actors)?.name).toBe('soon');
  });

  it('breaks a tie on higher effective Speed', () => {
    const actors = [
      actor({ name: 'plodder', at: 6, baseSpeed: 70, index: 0 }),
      actor({ name: 'quick', at: 6, baseSpeed: 130, index: 1 }),
    ];
    expect(nextToAct(actors)?.name).toBe('quick');
  });

  it('breaks a Speed tie on the lower actor index, so the player wins mirrors', () => {
    const actors = [
      actor({ name: 'first', at: 6, baseSpeed: 100, index: 0 }),
      actor({ name: 'second', at: 6, baseSpeed: 100, index: 1 }),
    ];
    expect(nextToAct(actors)?.name).toBe('first');
  });

  it('skips the dead', () => {
    const dead = { ...actor({ name: 'corpse', at: 1, baseSpeed: 130, index: 0 }), hp: 0 };
    const actors = [dead, actor({ name: 'living', at: 8, baseSpeed: 100, index: 1 })];
    expect(nextToAct(actors)?.name).toBe('living');
  });

  it('returns null when nobody is left', () => {
    expect(
      nextToAct([{ ...actor({ name: 'corpse', at: 1, baseSpeed: 100, index: 0 }), hp: 0 }]),
    ).toBeNull();
  });
});
