import { describe, expect, it } from 'vitest';
import { m0Catalogue } from '../../src/data/cards.ts';
import { PLAYER, RAT, ratAndWarden } from '../../src/data/encounters.ts';
import type { Action } from '../../src/sim/actions.ts';
import { advanceToDecision, reduce, startCombat } from '../../src/sim/combat.ts';
import type { CombatEvent } from '../../src/sim/events.ts';
import { nextIncomingHit, previewAction } from '../../src/sim/forecast.ts';
import { guardHoldsUntil, pointsLost } from '../../src/sim/guard.ts';
import { cardId } from '../../src/sim/ids.ts';
import { createRng, type Rng } from '../../src/sim/rng.ts';
import { DEFAULT_RULES } from '../../src/sim/rules.ts';
import { playerActor, type CombatState } from '../../src/sim/state.ts';
import { tick } from '../../src/sim/tick.ts';

const CATALOGUE = m0Catalogue();

/** The rat-and-Warden opening: the player is due at t6, both enemies at t9. */
function opening(rules = DEFAULT_RULES): CombatState {
  return advanceToDecision(
    startCombat({
      actors: ratAndWarden(),
      catalogue: CATALOGUE,
      deck: [cardId('crush')],
      rng: createRng(1, 'combat'),
      rules,
    }).state,
  ).state;
}

function withPlayerGuard(state: CombatState, guard: number): CombatState {
  return {
    ...state,
    actors: state.actors.map((actor) => (actor.id === PLAYER ? { ...actor, guard } : actor)),
  };
}

function withoutRat(state: CombatState): CombatState {
  return {
    ...state,
    actors: state.actors.map((actor) => (actor.id === RAT ? { ...actor, hp: 0 } : actor)),
  };
}

describe('the next blow, against the Guard that meets it (GDD §4.4)', () => {
  it('names the first telegraphed enemy hit in the forecast', () => {
    const hit = nextIncomingHit(opening());

    // The rat and the Warden are both due at t9; the rat wins the Speed
    // tie-break (GDD §4.1), so its Venom Bite is the blow to answer for.
    expect(hit).toEqual(
      expect.objectContaining({ source: RAT, name: 'Venom Bite', at: 9, damage: 1 }),
    );
  });

  it('decays the Guard to the tick the blow lands on, not the tick it is read on', () => {
    const hit = nextIncomingHit(withPlayerGuard(opening(), 6));

    // 6 Guard at t6 is 5 Guard at t9 — one point falls off every three ticks
    // (GDD §4.4 [AMD]) — and it still covers a 1-damage bite.
    expect(hit).toEqual(expect.objectContaining({ guard: 5, absorbed: 1, toHp: 0 }));
  });

  it('says how much of a blow too big for the Guard gets through', () => {
    const hit = nextIncomingHit(withoutRat(withPlayerGuard(opening(), 6)));

    // With the rat gone the Warden's Ruinous Swing is next: 13 against the 5
    // Guard left at t9.
    expect(hit).toEqual(
      expect.objectContaining({ name: 'Ruinous Swing', damage: 13, guard: 5, toHp: 8 }),
    );
  });

  it('reads the decay rate off the rules rather than assuming one', () => {
    // The rate is a tuning knob (GDD §22 Q6), so the forecast must not bake it.
    const brisk = { ...DEFAULT_RULES, guardDecayEvery: 1 };
    const hit = nextIncomingHit(withPlayerGuard(opening(brisk), 2));

    // Three ticks at a point each spends the whole 2 before the bite lands.
    expect(hit).toEqual(expect.objectContaining({ guard: 0, absorbed: 0, toHp: 1 }));
  });

  it('has nothing to report once the player is gone', () => {
    const dead = {
      ...opening(),
      actors: opening().actors.map((actor) => (actor.id === PLAYER ? { ...actor, hp: 0 } : actor)),
    };

    expect(nextIncomingHit(dead)).toBeNull();
  });
});

describe('the Guard window (GDD §4.4)', () => {
  it('holds three ticks per point at the default decay (GDD §4.4 [AMD])', () => {
    // The rate is now "ticks per point lost" rather than "points per tick", so
    // a larger number is a *slower* decay and a longer window.
    expect(guardHoldsUntil(5, tick(10), DEFAULT_RULES.guardDecayEvery)).toBe(24);
  });

  it('runs out sooner when the decay is faster', () => {
    expect(guardHoldsUntil(5, tick(10), 1)).toBe(15);
  });

  it('names the tick decay actually reaches zero on, not an estimate', () => {
    // The strip says "guard holds until t"; if that drifted from the grid
    // `decayGuard` uses, the caption would be wrong by up to `every - 1`.
    const every = DEFAULT_RULES.guardDecayEvery;
    const zeroAt = guardHoldsUntil(4, tick(7), every);
    if (zeroAt === null) throw new Error('Guard that decays must run out');

    expect(pointsLost(tick(7), zeroAt, every)).toBe(4);
    expect(pointsLost(tick(7), tick(zeroAt - 1), every)).toBeLessThan(4);
  });

  it('never runs out when Guard does not decay', () => {
    expect(guardHoldsUntil(5, tick(10), 0)).toBeNull();
  });
});

function legalActions(state: CombatState): readonly Action[] {
  const targets = state.actors.filter((actor) => actor.side === 'enemy' && actor.hp > 0);
  const plays = state.hand.flatMap((card) =>
    targets.map((target): Action => ({ kind: 'play', card, target: target.id })),
  );
  return [...plays, { kind: 'guard' }];
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  const chosen = items[rng.nextInt(items.length)];
  if (chosen === undefined) throw new Error('cannot pick from an empty list');
  return chosen;
}

/** The first blow the player actually took, read out of the committed log. */
function firstBlow(events: readonly CombatEvent[]): { at: number; amount: number } | null {
  const landed = events.find((event) => event.kind === 'damage_dealt' && event.target === PLAYER);
  return landed?.kind === 'damage_dealt' ? { at: landed.at, amount: landed.amount } : null;
}

/**
 * The readout's promise, checked the only way it can be: commit the action and
 * see whether the blow the preview named is the blow that landed (CLAUDE.md
 * §7.1). A preview that can disagree with the commit is worse than none.
 */
function checkDecision(rng: Rng, state: CombatState): CombatState | null {
  const action = pick(rng, legalActions(state));
  const preview = previewAction(state, action);
  const committed = reduce(state, action);
  if (preview === null || !committed.ok) return null;

  const advanced = advanceToDecision(committed.step.state);
  const player = playerActor(advanced.state);

  expect(preview.hpWhenPlayerActs).toBe(player?.hp ?? 0);

  const blow = firstBlow(advanced.events);
  const promised = preview.nextHit;
  if (promised !== null && blow !== null) {
    expect({ at: blow.at, amount: blow.amount }).toEqual({
      at: promised.at,
      amount: promised.damage,
    });
    // Guard is what the promise is about: it must have absorbed what was said.
    const absorbed = advanced.events.find(
      (event) => event.kind === 'guard_absorbed' && event.at === blow.at,
    );
    const actual = absorbed?.kind === 'guard_absorbed' ? absorbed.amount : 0;
    expect(actual).toBe(promised.absorbed);
  }

  return advanced.state;
}

/** One encounter played out at random, checking every decision on the way. */
function checkEncounter(rng: Rng, start: CombatState): number {
  let state = start;
  let checked = 0;

  for (let step = 0; step < 12; step += 1) {
    if (state.outcome !== 'ongoing' || state.activeActorId === null) break;
    const next = checkDecision(rng, state);
    if (next === null) break;
    state = next;
    checked += 1;
  }

  return checked;
}

describe('the Guard verdict is the one the commit delivers (CLAUDE.md §7.1)', () => {
  it('matches the blow that lands, across many generated decisions', () => {
    const rng = createRng(20260830, 'combat');
    let decisions = 0;

    // A spread of starting Guard, so the verdict is exercised holding, partly
    // holding, and absent.
    for (let encounter = 0; encounter < 40; encounter += 1) {
      decisions += checkEncounter(rng, withPlayerGuard(opening(), rng.nextInt(12)));
    }

    expect(decisions).toBeGreaterThanOrEqual(200);
  });
});
