import { describe, expect, it } from 'vitest';
import { m0Catalogue } from '../../src/data/cards.ts';
import { ratAndWarden } from '../../src/data/encounters.ts';
import type { Action } from '../../src/sim/actions.ts';
import { advanceToDecision, reduce, startCombat } from '../../src/sim/combat.ts';
import { GUARD_CAP } from '../../src/sim/guard.ts';
import { cardId, type CardId } from '../../src/sim/ids.ts';
import { HAND_CAP } from '../../src/sim/piles.ts';
import { createRng, type Rng } from '../../src/sim/rng.ts';
import type { Status } from '../../src/sim/status.ts';
import type { CombatState } from '../../src/sim/state.ts';

const CATALOGUE = m0Catalogue();
const ALL_CARDS: readonly CardId[] = Object.keys(CATALOGUE).map(cardId);

function pick<T>(rng: Rng, items: readonly T[]): T {
  const chosen = items[rng.nextInt(items.length)];
  if (chosen === undefined) throw new Error('empty list');
  return chosen;
}

function legalActions(state: CombatState): readonly Action[] {
  const targets = state.actors.filter((actor) => actor.side === 'enemy' && actor.hp > 0);
  const plays = state.hand.flatMap((card) =>
    targets.map((target): Action => ({ kind: 'play', card, target: target.id })),
  );
  return [...plays, { kind: 'guard' }];
}

/** A scheduled effect never sits in the past — it would already have resolved. */
function checkStatus(status: Status, state: CombatState): void {
  expect(status.nextProcAt ?? state.now).toBeGreaterThanOrEqual(state.now);
  expect(status.expiresAt ?? state.now).toBeGreaterThanOrEqual(state.now);
}

/** Every invariant that must hold of any reachable state (CLAUDE.md §7.1). */
function check(state: CombatState, previous: CombatState): void {
  expect(state.now).toBeGreaterThanOrEqual(previous.now);
  expect(state.hand.length).toBeLessThanOrEqual(HAND_CAP);

  for (const actor of state.actors) {
    expect(actor.guard).toBeGreaterThanOrEqual(0);
    expect(actor.guard).toBeLessThanOrEqual(GUARD_CAP);
    expect(actor.hp).toBeGreaterThanOrEqual(0);
    expect(actor.hp).toBeLessThanOrEqual(actor.maxHp);
    expect(Number.isInteger(actor.nextActTick)).toBe(true);

    // An actor that has already acted is never rescheduled into the past.
    if (actor.hp > 0) expect(actor.nextActTick).toBeGreaterThanOrEqual(state.now);

    for (const status of actor.statuses) checkStatus(status, state);
  }

  const cardsInPlay = state.draw.length + state.hand.length + state.cooldown.length;
  expect(cardsInPlay).toBe(previous.draw.length + previous.hand.length + previous.cooldown.length);
}

/** Plays one encounter to its end, checking every state it passes through. */
function walkOne(rng: Rng, opening: CombatState): number {
  let state = opening;
  let steps = 0;

  for (let step = 0; step < 30; step += 1) {
    if (state.outcome !== 'ongoing' || state.activeActorId === null) break;
    const result = reduce(state, pick(rng, legalActions(state)));
    if (!result.ok) break;

    const advanced = advanceToDecision(result.step.state);
    check(advanced.state, state);
    state = advanced.state;
    steps += 1;
  }

  return steps;
}

describe('tick invariants (CLAUDE.md §7.1)', () => {
  it('hold across a long random walk', () => {
    const rng = createRng(31337, 'combat');
    let walks = 0;

    for (let run = 0; run < 60; run += 1) {
      const deck = Array.from({ length: 6 + rng.nextInt(7) }, () => pick(rng, ALL_CARDS));
      const state = advanceToDecision(
        startCombat({ actors: ratAndWarden(), catalogue: CATALOGUE, deck, rng }).state,
      ).state;

      walks += walkOne(rng, state);
    }

    expect(walks).toBeGreaterThanOrEqual(400);
  });
});
