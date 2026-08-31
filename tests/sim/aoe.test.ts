import { describe, expect, it } from 'vitest';
import { m0Catalogue, parseCardCatalogue } from '../../src/data/cards.ts';
import { ENCOUNTERS, PLAYER, RAT, WARDEN, ratAndWarden } from '../../src/data/encounters.ts';
import { advanceToDecision, reduce, startCombat } from '../../src/sim/combat.ts';
import type { ActorSeed } from '../../src/sim/combat.ts';
import type { CombatEvent } from '../../src/sim/events.ts';
import { previewAction } from '../../src/sim/forecast.ts';
import { cardId } from '../../src/sim/ids.ts';
import { createRng } from '../../src/sim/rng.ts';
import { DEFAULT_RULES } from '../../src/sim/rules.ts';
import { findActor, livingEnemies, type CombatState } from '../../src/sim/state.ts';
import { AOE_DAMAGE_SHARE, damagePerTarget } from '../../src/sim/targeting.ts';

const CATALOGUE = m0Catalogue();
const CLEAVE = cardId('cleave');
const SWEEP = cardId('sweep');
const CATACLYSM = cardId('cataclysm');
const HAMMERFALL = cardId('hammerfall');

function opened(actors: readonly ActorSeed[], deck: readonly string[]): CombatState {
  return advanceToDecision(
    startCombat({
      actors,
      catalogue: CATALOGUE,
      deck: deck.map(cardId),
      rng: createRng(1, 'combat'),
    }).state,
  ).state;
}

function play(state: CombatState, card: string, target = RAT) {
  const result = reduce(state, { kind: 'play', card: cardId(card), target });
  if (!result.ok) throw new Error(`${card} refused: ${result.error.reason}`);
  return result.step;
}

/** What the player's own swing landed, in the order the line was struck. */
function blows(events: readonly CombatEvent[]): readonly { to: string; amount: number }[] {
  return events.flatMap((event) =>
    event.kind === 'damage_dealt' && event.source === PLAYER
      ? [{ to: event.target, amount: event.amount }]
      : [],
  );
}

function staggeredActors(events: readonly CombatEvent[]): readonly string[] {
  return events.flatMap((event) => (event.kind === 'staggered' ? [event.actor] : []));
}

/** GDD §4.8: AoE cards hit all enemies at reduced damage, Poise checked apart. */
describe('cards that hit the whole line (GDD §4.8)', () => {
  it('reaches every living enemy for 60% of the printed damage', () => {
    const state = opened(ratAndWarden(), ['cleave']);

    // Cleave prints 14; each of the two takes round(14 * 0.6) = 8.
    expect(damagePerTarget(CATALOGUE[CLEAVE] ?? never())).toBe(8);
    expect(blows(play(state, 'cleave').events)).toEqual([
      { to: RAT, amount: 8 },
      { to: WARDEN, amount: 8 },
    ]);
  });

  it('leaves a single-target card striking only what was clicked', () => {
    const state = opened(ratAndWarden(), ['hammerfall']);

    expect(CATALOGUE[HAMMERFALL]?.targeting).toBe('single');
    expect(blows(play(state, 'hammerfall').events)).toEqual([{ to: RAT, amount: 16 }]);
  });

  it('checks each enemy Poise against the figure that enemy took', () => {
    // The rat's Poise is 8 and the Warden's is 24 at this level. Cleave lands 8
    // on both: it breaks the rat and does nothing to the Warden — the [AMD]
    // case §4.8 names for why the check cannot be a shared pool.
    const state = opened(ratAndWarden(), ['cleave']);
    expect(findActor(state, RAT)?.poise).toBe(8);
    expect(findActor(state, WARDEN)?.poise).toBeGreaterThan(8);

    expect(staggeredActors(play(state, 'cleave').events)).toEqual([RAT]);
  });

  it('is worse than its single-target sibling alone, and better against three', () => {
    const solo = ENCOUNTERS[1];
    const crowd = ENCOUNTERS[5];
    if (solo === undefined || crowd === undefined) throw new Error('missing encounters');

    const alone = opened(solo.actors, ['sweep', 'lunge']);
    const target = livingEnemies(alone)[0]?.id ?? never();
    const swept = blows(play(alone, 'sweep', target).events);
    const lunged = blows(play(alone, 'lunge', target).events);
    expect(total(swept)).toBeLessThan(total(lunged));

    const many = opened(crowd.actors, ['sweep']);
    expect(livingEnemies(many)).toHaveLength(3);
    // Sweep prints 10, lands 6 on each of three: 18, against Lunge's 11.
    expect(total(blows(play(many, 'sweep', livingEnemies(many)[0]?.id ?? never()).events))).toBe(
      18,
    );
  });

  it('kills every enemy the swing reaches, and reports each death once', () => {
    const crowd = ENCOUNTERS[5];
    if (crowd === undefined) throw new Error('missing encounter');
    const full = opened(crowd.actors, ['cataclysm']);
    // Wounded to inside Cataclysm's 26, so the whole line falls to one swing.
    const state: CombatState = {
      ...full,
      actors: full.actors.map((actor) => (actor.side === 'enemy' ? { ...actor, hp: 20 } : actor)),
    };

    const struck = play(state, 'cataclysm', livingEnemies(state)[0]?.id ?? never());

    expect(blows(struck.events).map((blow) => blow.amount)).toEqual([26, 26, 26]);
    expect(struck.events.filter((event) => event.kind === 'actor_died')).toHaveLength(3);
    expect(struck.state.outcome).toBe('won');
  });

  it('resolves a wind-up Ultimate against the line as it stands when it lands', () => {
    const state = opened(ratAndWarden(), ['cataclysm']);
    const committed = reduce(
      { ...state, rules: { ...DEFAULT_RULES, ultimate: 'windup' } },
      { kind: 'play', card: CATACLYSM, target: RAT },
    );
    if (!committed.ok) throw new Error('cataclysm refused');

    // The strike carries the reduced figure and its reach, not the printed 44:
    // it expands over whoever is alive at impact, which a wind-up is long
    // enough to change (GDD §4.8, §22 Q1).
    expect(committed.step.state.pending[0]).toMatchObject({ amount: 26, targeting: 'all' });
  });

  it('previews exactly what the commit delivers, for every AoE in the deck', () => {
    for (const card of [CLEAVE, SWEEP, CATACLYSM]) {
      const state = opened(ratAndWarden(), [card]);
      const preview = previewAction(state, { kind: 'play', card, target: RAT });
      if (preview === null) throw new Error(`${card} should be legal`);

      const committed = play(state, card);

      // CLAUDE.md §7.1: the preview is the real reducer on a copy, so this must
      // hold hit for hit — an AoE is where an estimator would first drift.
      expect(preview.hits).toEqual(
        blows(committed.events).map((blow) => ({ target: blow.to, amount: blow.amount })),
      );
      expect(preview.staggers.map((entry) => entry.actor)).toEqual(
        staggeredActors(committed.events),
      );
    }
  });

  it('refuses to load a card whose targeting the data does not recognise', () => {
    const parsed = parseCardCatalogue({
      cards: [
        { id: 'wild', name: 'Wild', class: 'light', damage: 5, targeting: 'aoe', tag: 'Physical' },
      ],
    });

    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? [] : parsed.errors).toEqual(['card "wild" has an unknown targeting: "aoe"']);
  });

  it('pins the share the design named, so tuning it is a deliberate edit', () => {
    // GDD §4.8 says "typically 60%".
    expect(AOE_DAMAGE_SHARE).toBe(0.6);
  });
});

function total(hits: readonly { amount: number }[]): number {
  return hits.reduce((sum, hit) => sum + hit.amount, 0);
}

function never(): never {
  throw new Error('expected a value');
}
