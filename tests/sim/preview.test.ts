import { describe, expect, it } from 'vitest';
import { m0Catalogue } from '../../src/data/cards.ts';
import { ratAndWarden } from '../../src/data/encounters.ts';
import type { Action } from '../../src/sim/actions.ts';
import { advanceToDecision, reduce, startCombat, type ActorSeed } from '../../src/sim/combat.ts';
import type { CombatEvent } from '../../src/sim/events.ts';
import { previewAction, type QueueSlot } from '../../src/sim/forecast.ts';
import { cardId, type CardId } from '../../src/sim/ids.ts';
import { createRng, type Rng } from '../../src/sim/rng.ts';
import { findActor, type CombatState } from '../../src/sim/state.ts';

const CATALOGUE = m0Catalogue();
const ALL_CARDS: readonly CardId[] = Object.keys(CATALOGUE).map(cardId);

function pick<T>(rng: Rng, items: readonly T[]): T {
  const chosen = items[rng.nextInt(items.length)];
  if (chosen === undefined) throw new Error('cannot pick from an empty list');
  return chosen;
}

/** A varied opening: a random subset of the encounter and a random hand. */
function randomOpening(rng: Rng): CombatState {
  const roster = ratAndWarden();
  const player = roster[0];
  if (player === undefined) throw new Error('encounter has no player');
  const enemies = roster.slice(1).filter(() => rng.nextInt(4) > 0);
  const actors: readonly ActorSeed[] = enemies.length > 0 ? [player, ...enemies] : roster;

  const deckSize = 1 + rng.nextInt(8);
  const deck = Array.from({ length: deckSize }, () => pick(rng, ALL_CARDS));

  return advanceToDecision(startCombat({ actors, catalogue: CATALOGUE, deck, rng }).state).state;
}

function legalActions(state: CombatState): readonly Action[] {
  const targets = state.actors.filter((actor) => actor.side === 'enemy' && actor.hp > 0);
  const plays = state.hand.flatMap((card) =>
    targets.map((target): Action => ({ kind: 'play', card, target: target.id })),
  );
  return [...plays, { kind: 'wait' }];
}

function turnsTaken(events: readonly CombatEvent[]): string[] {
  return events
    .filter((event) => event.kind === 'turn_started')
    .map((event) => `${event.actor}@${String(event.at)}`);
}

/** The forecast up to and including the player's own next turn. */
function untilPlayerActs(state: CombatState, queue: readonly QueueSlot[]): string[] {
  const playerAt = queue.findIndex((slot) => findActor(state, slot.actor)?.side === 'player');
  const upto = playerAt === -1 ? queue : queue.slice(0, playerAt + 1);
  return upto.map((slot) => `${slot.actor}@${String(slot.at)}`);
}

/**
 * One decision: preview it, commit it, and assert the preview described exactly
 * what then happened. Returns the state after the commit, or null if there was
 * nothing legal left to do.
 */
function checkDecision(rng: Rng, state: CombatState): CombatState | null {
  const action = pick(rng, legalActions(state));
  const preview = previewAction(state, action);
  const committed = reduce(state, action);
  expect(committed.ok).toBe(preview !== null);
  if (!committed.ok || preview === null) return null;

  const advanced = advanceToDecision(committed.step.state);
  const expected = untilPlayerActs(committed.step.state, preview.queue);
  const actual = turnsTaken(advanced.events);

  if (advanced.state.outcome === 'ongoing') {
    expect(actual).toEqual(expected);
  } else {
    // A death can cut the sequence short, but never change it.
    expect(expected.slice(0, actual.length)).toEqual(actual);
  }

  return advanced.state;
}

function checkEncounter(rng: Rng, opening: CombatState): number {
  let state = opening;
  let checked = 0;

  for (let decision = 0; decision < 25; decision += 1) {
    if (state.outcome !== 'ongoing' || state.activeActorId === null) break;
    const next = checkDecision(rng, state);
    if (next === null) break;
    state = next;
    checked += 1;
  }

  return checked;
}

describe('ghost preview equivalence (CLAUDE.md §7.1, GDD §4.2)', () => {
  it('shows exactly the turns that then happen, across many generated cases', () => {
    const rng = createRng(20260829, 'combat');
    let cases = 0;

    for (let encounter = 0; encounter < 90; encounter += 1) {
      cases += checkEncounter(rng, randomOpening(rng));
    }

    expect(cases).toBeGreaterThanOrEqual(500);
  });

  it('never mutates the state it previews', () => {
    const rng = createRng(7, 'combat');
    const state = randomOpening(rng);
    const before = JSON.stringify(state);

    for (const action of legalActions(state)) previewAction(state, action);

    expect(JSON.stringify(state)).toBe(before);
  });

  it('returns nothing for an action the reducer would refuse', () => {
    const state = randomOpening(createRng(11, 'combat'));
    const target = state.actors[1]?.id;
    if (target === undefined) throw new Error('opening has no enemy');
    const absent = previewAction(state, { kind: 'play', card: cardId('nonesuch'), target });

    expect(absent).toBeNull();
  });

  it('reports the damage the commit actually deals', () => {
    const state = randomOpening(createRng(3, 'combat'));
    const target = state.actors.find((actor) => actor.side === 'enemy');
    const card = state.hand[0];
    if (target === undefined || card === undefined) throw new Error('unusable opening');

    const action: Action = { kind: 'play', card, target: target.id };
    const preview = previewAction(state, action);
    const committed = reduce(state, action);
    if (preview === null || !committed.ok) throw new Error('action should be legal');

    const dealt = committed.step.events
      .filter((event) => event.kind === 'damage_dealt')
      .map((event) => ({ target: event.target, amount: event.amount }));

    expect(preview.hits).toEqual(dealt);
    expect(preview.hits[0]?.amount).toBe(CATALOGUE[card]?.damage);
  });
});

describe('what the preview tells the player (GDD §4.2, §15)', () => {
  it('counts the enemy turns bought by a Heavy card, and their cost', () => {
    const state = advanceToDecision(
      startCombat({
        actors: ratAndWarden(),
        catalogue: CATALOGUE,
        deck: [cardId('crush')],
        rng: createRng(1, 'combat'),
      }).state,
    ).state;

    const rat = ratAndWarden()[1]?.id;
    if (rat === undefined) throw new Error('encounter has no rat');
    const preview = previewAction(state, { kind: 'play', card: cardId('crush'), target: rat });
    if (preview === null) throw new Error('crush should be legal');

    // Playing at t6 for Weight 10 puts the player at t16. The rat bites at t9
    // and t13, and the Warden's telegraphed swing lands at t9.
    expect(preview.playerNextTick).toBe(16);
    expect(preview.enemyTurnsBeforePlayer).toBe(3);
    expect(preview.incomingDamage).toBe(24);
  });

  it('counts an enemy that shares the player tick but wins the tie-break', () => {
    const state = advanceToDecision(
      startCombat({
        actors: ratAndWarden(),
        catalogue: CATALOGUE,
        deck: [cardId('crush')],
        rng: createRng(1, 'combat'),
      }).state,
    ).state;

    const waiting = previewAction(state, { kind: 'wait' });
    if (waiting === null) throw new Error('wait is always legal');

    // The player returns at t9 — and so does the rat, which wins the tie on
    // Speed (GDD §4.1). One bite lands first, not none: "before you" is a
    // question about queue order, not about tick numbers.
    expect(waiting.playerNextTick).toBe(9);
    expect(waiting.enemyTurnsBeforePlayer).toBe(1);
    expect(waiting.incomingDamage).toBe(3);
  });
});
