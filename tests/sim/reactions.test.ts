import { describe, expect, it } from 'vitest';
import { m0Catalogue } from '../../src/data/cards.ts';
import { RAT, soloRat } from '../../src/data/encounters.ts';
import { advanceToDecision, reduce, startCombat } from '../../src/sim/combat.ts';
import { advanceTime } from '../../src/sim/effects.ts';
import type { CombatEvent } from '../../src/sim/events.ts';
import { previewAction } from '../../src/sim/forecast.ts';
import { freshBuild, runtimeOf, type BuildState, type Gem } from '../../src/sim/gem.ts';
import { cardId, gemId, type CardId, type GemId } from '../../src/sim/ids.ts';
import { createRng } from '../../src/sim/rng.ts';
import { findActor, type CombatState } from '../../src/sim/state.ts';
import { tick } from '../../src/sim/tick.ts';
import { PLAYER } from '../../src/data/encounters.ts';

/**
 * The react phase (GDD §6.2, docs/M1_PLAN.md D33 and §5).
 *
 * These frames accumulate across a fight, which is the only part of the build
 * layer that can *change* while the player is looking at it. That makes the
 * purity assertion below the most important test in this file: `previewAction`
 * runs the real reducer on the real state and does not clone it, so a handler
 * that wrote in place would spend a charge on hover.
 */

const CATALOGUE = m0Catalogue();
const LUNGE = cardId('lunge');
const CLEAVE = cardId('cleave');

function gem(id: string, fields: Partial<Gem>): Gem {
  return {
    id: gemId(id),
    frame: 'CHARGE',
    tier: 1,
    words: [],
    weightDelta: 0,
    effects: [],
    affixes: [],
    ...fields,
  };
}

function build(card: CardId, ...gems: readonly Gem[]): BuildState {
  return freshBuild({
    gems: Object.fromEntries(gems.map((entry) => [entry.id, entry])),
    sockets: {
      [card]: { opened: gems.length, gems: gems.map((entry) => entry.id), scarred: false },
    },
    runtime: {},
  });
}

/** Charges are earned in the fight they are spent in, so they are seeded after
 * `startCombat` — which rightly zeroes them (GDD §6.2). */
function charged(state: CombatState, gem: GemId, charges: number): CombatState {
  return { ...state, build: { ...state.build, runtime: { [gem]: { charges, uses: 0 } } } };
}

function opened(deck: readonly CardId[], loadout: BuildState, ratHp?: number): CombatState {
  const started = startCombat({
    actors: soloRat(),
    catalogue: CATALOGUE,
    deck,
    rng: createRng(1, 'combat'),
    build: loadout,
  });
  const state = advanceToDecision(started.state).state;
  if (ratHp === undefined) return state;
  return {
    ...state,
    actors: state.actors.map((actor) => (actor.id === RAT ? { ...actor, hp: ratHp } : actor)),
  };
}

type DamageEvent = Extract<CombatEvent, { kind: 'damage_dealt' }>;

function totalDamage(events: readonly CombatEvent[]): number {
  return events
    .filter((event): event is DamageEvent => event.kind === 'damage_dealt')
    .reduce((total, event) => total + event.amount, 0);
}

function play(
  state: CombatState,
  card: CardId,
): { state: CombatState; events: readonly CombatEvent[] } {
  const result = reduce(state, { kind: 'play', card, target: RAT });
  if (!result.ok) throw new Error(`refused: ${result.error.reason}`);
  return { state: result.step.state, events: result.step.events };
}

describe('a preview never changes the board (CLAUDE.md §7.1)', () => {
  it('leaves the real state deep-equal after previewing a stateful gem', () => {
    // The case that would break it: SPEND reads its charges and CONSUME zeroes
    // them, so a handler writing in place would be visible on the very next
    // hover. previewAction does not clone — it trusts the reducer.
    const spend = gem('g_spend', {
      frame: 'SPEND',
      effects: [
        { type: 'SPEND_CHARGES', value: 0.5, tag: null },
        { type: 'CONSUME_CHARGES', value: 0, tag: null },
      ],
    });
    const state = charged(opened([LUNGE, LUNGE], build(LUNGE, spend)), gemId('g_spend'), 3);

    const before = structuredClone(state);
    for (const target of state.actors.filter((actor) => actor.side === 'enemy')) {
      previewAction(state, { kind: 'play', card: LUNGE, target: target.id });
    }
    previewAction(state, { kind: 'wait' });

    expect(structuredClone(state)).toEqual(before);
    expect(runtimeOf(state.build, gemId('g_spend')).charges).toBe(3);
  });

  it('survives a structuredClone round trip, so a save can hold it', () => {
    const state = opened([LUNGE], build(LUNGE, gem('g_c', {})));
    const roundTripped: CombatState = structuredClone(state);

    expect(roundTripped).toEqual(state);
  });
});

describe('CHARGE stores on a kill, SPEND consumes it (GDD §6.2)', () => {
  it('gains a charge only when something actually dies', () => {
    const charge = gem('g_charge', {
      frame: 'CHARGE',
      effects: [{ type: 'CHARGE_ON_KILL', value: 1, tag: null }],
    });
    const id: GemId = gemId('g_charge');

    const survives = opened([LUNGE, LUNGE], build(LUNGE, charge));
    expect(runtimeOf(play(survives, LUNGE).state.build, id).charges).toBe(0);

    const lethal = opened([LUNGE, LUNGE], build(LUNGE, charge), 1);
    expect(runtimeOf(play(lethal, LUNGE).state.build, id).charges).toBe(1);
  });

  it('spends what it stored, and has nothing left afterwards', () => {
    const spend = gem('g_spend', {
      frame: 'SPEND',
      effects: [
        { type: 'SPEND_CHARGES', value: 0.5, tag: null },
        { type: 'CONSUME_CHARGES', value: 0, tag: null },
      ],
    });
    const id: GemId = gemId('g_spend');
    const state = charged(opened([LUNGE, LUNGE], build(LUNGE, spend)), id, 2);

    const swung = play(state, LUNGE);
    const dealt = totalDamage(swung.events);

    // Lunge is 11; two charges at +50% each is x2, so 22.
    expect(dealt).toBe(22);
    expect(runtimeOf(swung.state.build, id).charges).toBe(0);
  });

  it('is a dead socket until something is charged — §6.2 says so out loud', () => {
    const spend = gem('g_spend', {
      frame: 'SPEND',
      effects: [{ type: 'SPEND_CHARGES', value: 0.5, tag: null }],
    });
    const state = opened([LUNGE], build(LUNGE, spend));
    const dealt = totalDamage(play(state, LUNGE).events);

    expect(dealt).toBe(11);
  });
});

describe('ECHO returns the card, once (GDD §6.2)', () => {
  it('puts the card back in hand instead of on its Recovery clock', () => {
    const echo = gem('g_echo', {
      frame: 'ECHO',
      effects: [
        { type: 'RETURN_TO_HAND', value: 0, tag: null },
        { type: 'MARK_USED', value: 0, tag: null },
      ],
    });
    const state = opened([LUNGE, LUNGE], build(LUNGE, echo));

    const first = play(state, LUNGE);
    expect(first.state.hand).toContain(LUNGE);
    expect(first.state.cooldown).toHaveLength(0);
  });

  it('fires exactly once a fight, and cools normally after that', () => {
    const echo = gem('g_echo', {
      frame: 'ECHO',
      effects: [
        { type: 'RETURN_TO_HAND', value: 0, tag: null },
        { type: 'MARK_USED', value: 0, tag: null },
      ],
    });
    const state = opened([LUNGE, LUNGE], build(LUNGE, echo));

    const first = play(state, LUNGE);
    const ready = advanceToDecision(first.state).state;
    const second = play(ready, LUNGE);

    expect(second.state.cooldown.map((entry) => entry.card)).toContain(LUNGE);
    expect(runtimeOf(second.state.build, gemId('g_echo')).uses).toBe(2);
  });

  it('starts every encounter fresh, so a use is not carried in', () => {
    const echo = gem('g_echo', {
      frame: 'ECHO',
      effects: [{ type: 'MARK_USED', value: 0, tag: null }],
    });
    const spent = {
      ...build(LUNGE, echo),
      runtime: { [gemId('g_echo')]: { charges: 4, uses: 9 } },
    };
    const state = opened([LUNGE], spent);

    expect(runtimeOf(state.build, gemId('g_echo'))).toEqual({ charges: 0, uses: 0 });
  });
});

describe('SIPHON heals the one who swung (GDD §6.2)', () => {
  it('returns a share of what actually landed, capped by Max HP', () => {
    const siphon = gem('g_siphon', {
      frame: 'SIPHON',
      effects: [{ type: 'SIPHON_HIT', value: 0.5, tag: null }],
    });
    const state = opened([LUNGE], build(LUNGE, siphon));
    const wounded: CombatState = {
      ...state,
      actors: state.actors.map((actor) => (actor.id === PLAYER ? { ...actor, hp: 40 } : actor)),
    };

    const swung = play(wounded, LUNGE);

    // Lunge lands 11 on an unresisting rat; half of that comes back.
    expect(findActor(swung.state, PLAYER)?.hp).toBe(46);
    expect(swung.events.some((event) => event.kind === 'healed')).toBe(true);
  });

  it('cannot heal past the pool it is refilling', () => {
    const siphon = gem('g_siphon', {
      frame: 'SIPHON',
      effects: [{ type: 'SIPHON_HIT', value: 1, tag: null }],
    });
    const state = opened([LUNGE], build(LUNGE, siphon));
    const swung = play(state, LUNGE);
    const player = findActor(swung.state, PLAYER);

    expect(player?.hp).toBe(player?.maxHp);
  });
});

describe('WARD puts Guard up as well (GDD §6.2, §4.4)', () => {
  it('grants its Guard when the card is played', () => {
    const ward = gem('g_ward', {
      frame: 'WARD',
      weightDelta: 2,
      effects: [{ type: 'GUARD_GAIN', value: 6, tag: null }],
    });
    const state = opened([LUNGE], build(LUNGE, ward));
    const swung = play(state, LUNGE);

    expect(findActor(swung.state, PLAYER)?.guard).toBe(6);
    expect(swung.events.some((event) => event.kind === 'guard_gained')).toBe(true);
  });

  it('respects the Guard cap, which is a rule and not a suggestion (§4.4)', () => {
    const ward = gem('g_ward', {
      frame: 'WARD',
      effects: [{ type: 'GUARD_GAIN', value: 99, tag: null }],
    });
    const state = opened([LUNGE], build(LUNGE, ward));

    expect(findActor(play(state, LUNGE).state, PLAYER)?.guard).toBe(state.rules.guardCap);
  });
});

describe('LINGER stretches what a card inflicts (GDD §6.2)', () => {
  it('lasts longer and hits for less', () => {
    const linger = gem('g_linger', {
      frame: 'LINGER',
      effects: [
        { type: 'STATUS_DURATION', value: 1, tag: null },
        { type: 'STATUS_MAGNITUDE', value: -0.5, tag: null },
      ],
    });
    // Cleave carries Burn 2 for 20 ticks (docs/M1_PLAN.md D34).
    const bare = opened([CLEAVE], freshBuild({ gems: {}, sockets: {}, runtime: {} }));
    const armed = opened([CLEAVE], build(CLEAVE, linger));

    const burnOn = (state: CombatState): { magnitude: number; expiresAt: number } => {
      const status = findActor(play(state, CLEAVE).state, RAT)?.statuses.find(
        (entry) => entry.kind === 'burn',
      );
      if (status === undefined) throw new Error('no burn');
      return { magnitude: status.magnitude, expiresAt: status.expiresAt ?? 0 };
    };

    const without = burnOn(bare);
    const with_ = burnOn(armed);

    expect(with_.magnitude).toBeLessThan(without.magnitude);
    expect(with_.expiresAt).toBeGreaterThan(without.expiresAt);
  });

  it('never stretches a status into one that does nothing', () => {
    const linger = gem('g_linger', {
      frame: 'LINGER',
      effects: [{ type: 'STATUS_MAGNITUDE', value: -0.99, tag: null }],
    });
    const state = opened([CLEAVE], build(CLEAVE, linger));
    const burn = findActor(play(state, CLEAVE).state, RAT)?.statuses.find(
      (entry) => entry.kind === 'burn',
    );

    expect(burn?.magnitude).toBeGreaterThanOrEqual(1);
  });
});

describe('a corpse carries nothing forward (GDD §4.5, §7.1 invariants)', () => {
  it('drops the statuses of an actor that dies of one', () => {
    const state = opened([CLEAVE], freshBuild({ gems: {}, sockets: {}, runtime: {} }), 9);
    const burning = play(state, CLEAVE).state;
    const settled = advanceTime(burning, tick(burning.now + 30)).state;
    const rat = findActor(settled, RAT);

    expect(rat?.hp).toBe(0);
    expect(rat?.statuses).toEqual([]);
  });
});
