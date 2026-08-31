import { describe, expect, it } from 'vitest';
import { CHIME_ADEPT, POISON_RAT, WARDEN } from '../../src/data/archetypes.ts';
import { m0Catalogue } from '../../src/data/cards.ts';
import { ADEPT, ENCOUNTERS, PLAYER, RAT, scaleEnemy } from '../../src/data/encounters.ts';
import { currentIntent } from '../../src/sim/actor.ts';
import { advanceToDecision, reduce, startCombat } from '../../src/sim/combat.ts';
import { forecastQueue } from '../../src/sim/forecast.ts';
import { cardId } from '../../src/sim/ids.ts';
import { createRng } from '../../src/sim/rng.ts';
import { findActor, type CombatState } from '../../src/sim/state.ts';
import { magnitudeOf } from '../../src/sim/status.ts';

const CATALOGUE = m0Catalogue();

function opened(name: string): CombatState {
  const encounter = ENCOUNTERS.find((candidate) => candidate.name === name);
  if (encounter === undefined) throw new Error(`no encounter named ${name}`);

  const started = startCombat({
    actors: encounter.actors,
    catalogue: CATALOGUE,
    deck: Object.keys(CATALOGUE).map(cardId),
    rng: createRng(5, 'combat'),
  });
  return advanceToDecision(started.state).state;
}

describe('enemy scaling (GDD §12.1)', () => {
  it('scales HP, damage and Poise with level — and never Speed', () => {
    const one = scaleEnemy(POISON_RAT, 1, 'a');
    const five = scaleEnemy(POISON_RAT, 5, 'b');

    expect(five.maxHp).toBeGreaterThan(one.maxHp);
    expect(five.poise).toBeGreaterThan(one.poise);
    expect(five.intents[0]?.damage).toBeGreaterThan(one.intents[0]?.damage ?? 0);

    // Speed is the player's axis. If enemy Speed grew, the queue-planning skill
    // would decay over a run (GDD §12.1).
    expect(five.baseSpeed).toBe(POISON_RAT.baseSpeed);
    expect(one.baseSpeed).toBe(POISON_RAT.baseSpeed);
  });
});

describe('intent rotations (GDD §4.2, §12.2)', () => {
  it('telegraphs what it will actually do, then advances', () => {
    const state = opened('The Long Wind');
    const warden = state.actors.find((actor) => actor.name === WARDEN.name);
    if (warden === undefined) throw new Error('no warden');

    expect(currentIntent(warden)?.name).toBe('Ruinous Swing');

    // Let the swing land, and the rotation moves to the follow-up.
    let current = state;
    for (let turn = 0; turn < 3 && current.outcome === 'ongoing'; turn += 1) {
      const waited = reduce(current, { kind: 'guard' });
      if (!waited.ok) break;
      current = advanceToDecision(waited.step.state).state;
    }

    const after = current.actors.find((actor) => actor.name === WARDEN.name);
    expect(after?.intentIndex).not.toBe(warden.intentIndex);
  });

  it('forecasts the rotation, not one intent repeated', () => {
    const state = opened('The Long Wind');
    const wardenSlots = forecastQueue(state).filter((slot) => slot.actor !== PLAYER);
    const names = wardenSlots.map((slot) => slot.intent?.name);

    // A rotation the player can learn is what makes eight slots worth reading.
    expect(new Set(names).size).toBeGreaterThan(1);
    expect(names[0]).toBe('Ruinous Swing');
    expect(names[1]).toBe('Backhand');
  });
});

describe('the archetypes carry their signature (GDD §12.2)', () => {
  it('poisons the player when the rat’s rotation reaches Venom Bite', () => {
    let state = opened('Scurry');

    for (let turn = 0; turn < 6 && state.outcome === 'ongoing'; turn += 1) {
      const waited = reduce(state, { kind: 'guard' });
      if (!waited.ok) break;
      state = advanceToDecision(waited.step.state).state;

      const player = findActor(state, PLAYER);
      if (player !== undefined && magnitudeOf(player.statuses, 'poison') > 0) return;
    }

    throw new Error('the rat never applied Poison');
  });

  it('slows the player, which lengthens every card they then play', () => {
    let state = opened('Discord');
    const adept = findActor(state, ADEPT);
    expect(adept?.name).toBe(CHIME_ADEPT.name);

    for (let turn = 0; turn < 6 && state.outcome === 'ongoing'; turn += 1) {
      const waited = reduce(state, { kind: 'guard' });
      if (!waited.ok) break;
      state = advanceToDecision(waited.step.state).state;

      const player = findActor(state, PLAYER);
      if (player !== undefined && magnitudeOf(player.statuses, 'slow') > 0) return;
    }

    throw new Error('the adept never applied Slow');
  });

  it('gives the rat a Poise threshold a Light card can break', () => {
    const state = opened('Scurry');
    const rat = findActor(state, RAT);
    if (rat === undefined) throw new Error('no rat');

    // Strike deals 9 into a threshold of 8 — the archetype is the tutorial for
    // Stagger, so a starter card has to be able to break it (GDD §12.2).
    expect(CATALOGUE.lunge?.damage).toBeGreaterThanOrEqual(rat.poise);
  });
});

describe('the M0 encounter set', () => {
  it('builds six encounters, ending with all three archetypes at once', () => {
    expect(ENCOUNTERS).toHaveLength(6);
    const last = ENCOUNTERS.at(-1);
    expect(last?.actors).toHaveLength(4);
    expect(new Set(last?.actors.map((actor) => actor.name)).size).toBe(4);
  });

  it('gives every encounter a distinct roster', () => {
    const rosters = ENCOUNTERS.map((encounter) =>
      encounter.actors.map((actor) => actor.id).join('+'),
    );
    expect(new Set(rosters).size).toBe(ENCOUNTERS.length);
  });
});
