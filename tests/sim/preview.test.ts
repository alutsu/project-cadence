import { describe, expect, it } from 'vitest';
import { m0Catalogue } from '../../src/data/cards.ts';
import { RAT, ratAndWarden, soloRat } from '../../src/data/encounters.ts';
import type { Action } from '../../src/sim/actions.ts';
import { advanceToDecision, reduce, startCombat, type ActorSeed } from '../../src/sim/combat.ts';
import type { CombatEvent } from '../../src/sim/events.ts';
import { previewAction, type QueueSlot } from '../../src/sim/forecast.ts';
import { cardId, type CardId } from '../../src/sim/ids.ts';
import { createRng, type Rng } from '../../src/sim/rng.ts';
import { findActor, type CombatState } from '../../src/sim/state.ts';
import { damagePerTarget } from '../../src/sim/targeting.ts';
import { damageAgainst } from '../../src/sim/strike.ts';
import { gemId, type GemId } from '../../src/sim/ids.ts';
import type { BuildState, CardSockets, Gem } from '../../src/sim/gem.ts';
import { TAGS } from '../../src/sim/tag.ts';
import { NEUTRAL_WEAVE, type Attunement, type WeaveSnapshot } from '../../src/sim/weave.ts';

const CATALOGUE = m0Catalogue();
const ALL_CARDS: readonly CardId[] = Object.keys(CATALOGUE).map(cardId);

function pick<T>(rng: Rng, items: readonly T[]): T {
  const chosen = items[rng.nextInt(items.length)];
  if (chosen === undefined) throw new Error('cannot pick from an empty list');
  return chosen;
}

const ATTUNEMENTS: readonly Attunement[] = ['ascendant', 'neutral', 'suppressed'];

/** A Weave that is actually doing something, so the preview has to price it. */
function randomWeave(rng: Rng): WeaveSnapshot {
  return {
    attunement: Object.fromEntries(
      TAGS.map((tag) => [tag, pick(rng, ATTUNEMENTS)]),
    ) as WeaveSnapshot['attunement'],
    saturation: Object.fromEntries(
      TAGS.map((tag) => [tag, rng.nextInt(4) * 0.06]),
    ) as WeaveSnapshot['saturation'],
  };
}

const GEM_SHAPES: readonly ((id: GemId, rng: Rng) => Gem)[] = [
  (id, rng) => ({
    id,
    frame: 'REPEAT',
    tier: 1,
    words: [],
    weightDelta: 1 + rng.nextInt(3),
    effects: [
      { type: 'EXTRA_STRIKE', value: 1, tag: null },
      { type: 'DAMAGE_MULT', value: -0.3 - rng.nextInt(3) * 0.05, tag: null },
    ],
    affixes: [],
  }),
  (id, rng) => ({
    id,
    frame: 'HASTE',
    tier: 2,
    words: [],
    weightDelta: -1 - rng.nextInt(2),
    effects: [
      { type: 'RECOVERY_DELTA', value: -2 - rng.nextInt(6), tag: null },
      { type: 'DAMAGE_MULT', value: -0.2, tag: null },
    ],
    affixes: [],
  }),
  (id, rng) => ({
    id,
    frame: 'KINDLE',
    tier: 3,
    words: [],
    weightDelta: 0,
    effects: [{ type: 'CONVERT_TAG', value: 0, tag: pick(rng, TAGS) }],
    affixes: [],
  }),
  (id, rng) => ({
    id,
    frame: 'BREAK',
    tier: 4,
    words: [],
    weightDelta: 0,
    effects: [
      { type: 'POISE_FACTOR', value: 0.2 + rng.nextInt(4) * 0.15, tag: null },
      { type: 'STAGGER_BONUS', value: rng.nextInt(2), tag: null },
      { type: 'DAMAGE_MULT', value: -0.2, tag: null },
    ],
    affixes: [],
  }),
];

/**
 * A build with gems actually seated. This is what makes the equivalence test
 * cover M1 rather than only M0: the preview now has to fold sockets, convert a
 * tag, split a REPEAT into two blows and price each against its own defender,
 * and still land on exactly what the commit produces.
 */
function randomBuild(rng: Rng, deck: readonly CardId[]): BuildState {
  const gems: Record<string, Gem> = {};
  const sockets: Record<string, CardSockets> = {};

  for (const card of new Set(deck)) {
    const opened = rng.nextInt(4);
    if (opened === 0) continue;

    const seated: GemId[] = [];
    for (let socket = 0; socket < opened; socket += 1) {
      const id = gemId(`${card}_${String(socket)}`);
      gems[id] = pick(rng, GEM_SHAPES)(id, rng);
      seated.push(id);
    }
    sockets[card] = { opened, gems: seated, scarred: false };
  }

  return { gems, sockets };
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

  // Half the cases are built and half are bare, so a regression that only
  // shows up with gems and one that only shows up without both get caught.
  const built = rng.nextInt(2) === 1;
  const setup = built
    ? { build: randomBuild(rng, deck), weave: randomWeave(rng) }
    : { build: undefined, weave: NEUTRAL_WEAVE };

  return advanceToDecision(
    startCombat({
      actors,
      catalogue: CATALOGUE,
      deck,
      rng,
      weave: setup.weave,
      ...(setup.build === undefined ? {} : { build: setup.build }),
    }).state,
  ).state;
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

    // Not the printed figure, and no longer even the AoE share of it: the
    // Weave prices the blow against this defender's resistance (GDD §7.2), so
    // the only honest reference is the sim's own reading of the same card.
    const definition = CATALOGUE[card];
    const struck = findActor(state, target.id);
    if (definition === undefined || struck === undefined) throw new Error('unusable case');
    expect(preview.hits[0]?.amount).toBe(damageAgainst(state, definition, struck.id));
    expect(damagePerTarget(definition)).toBeGreaterThan(0);
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

    // Playing at t6 for Weight 10 puts the player at t16. Crush also breaks the
    // rat's Poise, so its bite slides from t9 to t12 — but three enemy turns
    // still land first: the Warden's swing at t9 for 13, then the rat twice for
    // 1 and 2.
    expect(preview.playerNextTick).toBe(16);
    expect(preview.enemyTurnsBeforePlayer).toBe(3);
    expect(preview.incomingDamage).toBe(16);
    expect(preview.staggers).toEqual([expect.objectContaining({ delay: 3 })]);
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
    // question about queue order, not about tick numbers. The rat has already
    // acted once, so its rotation is on Venom Bite (GDD §12.2).
    expect(waiting.playerNextTick).toBe(9);
    expect(waiting.enemyTurnsBeforePlayer).toBe(1);
    expect(waiting.incomingDamage).toBe(1);
  });

  it('reports that a lethal card ends the encounter, not the tick it would buy', () => {
    // The *last* enemy: killing one of two only advances the target (GDD §4.8).
    const opened = advanceToDecision(
      startCombat({
        actors: soloRat(),
        catalogue: CATALOGUE,
        deck: [cardId('crush')],
        rng: createRng(1, 'combat'),
      }).state,
    ).state;

    const frail = {
      ...opened,
      actors: opened.actors.map((actor) => (actor.id === RAT ? { ...actor, hp: 1 } : actor)),
    };

    const lethal = previewAction(frail, { kind: 'play', card: cardId('crush'), target: RAT });
    if (lethal === null) throw new Error('crush should be legal');

    // The player is still scheduled — they simply never get there, because the
    // last enemy dies on their own turn. Only `outcome` can say that.
    expect(lethal.outcome).toBe('won');
    expect(lethal.playerNextTick).not.toBeNull();

    const survivable = previewAction(opened, { kind: 'play', card: cardId('crush'), target: RAT });
    expect(survivable?.outcome).toBe('ongoing');
  });
});

/**
 * The generator is only worth its runtime if it actually produces the states it
 * claims to. A build that silently came out empty would leave the M1 half of
 * the highest-value test in the codebase (CLAUDE.md §7.1) asserting nothing.
 */
describe('the generated cases really are built (docs/M1_PLAN.md §5)', () => {
  it('produces socketed states, with gems seated and a Weave that moves', () => {
    const rng = createRng(20260829, 'combat');
    let socketed = 0;
    let moved = 0;

    for (let encounter = 0; encounter < 90; encounter += 1) {
      const state = randomOpening(rng);
      if (Object.keys(state.build.sockets).length > 0) socketed += 1;
      if (TAGS.some((tag) => state.weave.attunement[tag] !== 'neutral')) moved += 1;
    }

    expect(socketed).toBeGreaterThan(20);
    expect(moved).toBeGreaterThan(20);
  });
});
