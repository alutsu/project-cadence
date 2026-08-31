import { describe, expect, it } from 'vitest';
import { m0Catalogue } from '../../src/data/cards.ts';
import { parseGemCatalogue } from '../../src/data/gems.ts';
import { frameTable, parseFrameTable, rangeAt } from '../../src/data/frames.ts';
import { RAT, ratAndWarden, soloRat, WARDEN } from '../../src/data/encounters.ts';
import { advanceToDecision, reduce, startCombat } from '../../src/sim/combat.ts';
import type { CombatEvent } from '../../src/sim/events.ts';
import { cardId, gemId, type CardId } from '../../src/sim/ids.ts';
import { createRng } from '../../src/sim/rng.ts';
import { EMPTY_BUILD, FRAMES, GEM_TIERS, type BuildState, type Gem } from '../../src/sim/gem.ts';
import { previewAction } from '../../src/sim/forecast.ts';
import { resolveCard } from '../../src/sim/resolve.ts';
import { NEUTRAL_WEAVE } from '../../src/sim/weave.ts';
import type { CombatState } from '../../src/sim/state.ts';
import { isRegisteredEffect } from '../../src/sim/gemEffects.ts';

/**
 * Gems and the effect-atom registry (GDD §6.2, docs/M1_PLAN.md D33).
 *
 * The exit criterion for this sprint is that a hand-authored loadout changes
 * damage, Weight and Recovery *identically in the reducer and in the hover* —
 * so most of what is asserted here is agreement between two readings, not the
 * value of either one.
 */

const CATALOGUE = m0Catalogue();
const CRUSH = cardId('crush');
const LUNGE = cardId('lunge');
const SWEEP = cardId('sweep');

function gem(id: string, fields: Partial<Gem>): Gem {
  return {
    id: gemId(id),
    frame: 'REPEAT',
    tier: 1,
    words: [],
    weightDelta: 0,
    effects: [],
    affixes: [],
    ...fields,
  };
}

function build(card: CardId, ...gems: readonly Gem[]): BuildState {
  return {
    gems: Object.fromEntries(gems.map((entry) => [entry.id, entry])),
    sockets: {
      [card]: { opened: gems.length, gems: gems.map((entry) => entry.id), scarred: false },
    },
  };
}

function opened(options: {
  readonly deck: readonly CardId[];
  readonly actors: ReturnType<typeof soloRat>;
  readonly build?: BuildState;
}): CombatState {
  const started = startCombat({
    actors: options.actors,
    catalogue: CATALOGUE,
    deck: options.deck,
    rng: createRng(1, 'combat'),
    build: options.build ?? EMPTY_BUILD,
  });
  return advanceToDecision(started.state).state;
}

function damageTo(events: readonly CombatEvent[], target: string): number {
  return events
    .filter((event) => event.kind === 'damage_dealt' && event.target === target)
    .reduce((total, event) => total + (event.kind === 'damage_dealt' ? event.amount : 0), 0);
}

function play(state: CombatState, card: CardId): readonly CombatEvent[] {
  const result = reduce(state, { kind: 'play', card, target: RAT });
  if (!result.ok) throw new Error(`refused: ${result.error.reason}`);
  return result.step.events;
}

function card(id: CardId) {
  const found = CATALOGUE[id];
  if (found === undefined) throw new Error(`missing card ${id}`);
  return found;
}

describe('a gem changes the card it is seated in (GDD §6.2)', () => {
  it('multiplies damage, and the hover agrees with the commit', () => {
    // Lunge is Physical 11, and the rat resists no Physical.
    const halved = gem('g_half', { effects: [{ type: 'DAMAGE_MULT', value: -0.5, tag: null }] });
    const state = opened({ deck: [LUNGE], actors: soloRat(), build: build(LUNGE, halved) });

    const preview = previewAction(state, { kind: 'play', card: LUNGE, target: RAT });
    expect(preview?.hits.map((hit) => hit.amount)).toEqual([6]);
    expect(damageTo(play(state, LUNGE), RAT)).toBe(6);
  });

  it('moves Weight and Recovery, and the queue moves with them', () => {
    const hasted = gem('g_haste', {
      frame: 'HASTE',
      weightDelta: -2,
      effects: [{ type: 'RECOVERY_DELTA', value: -3, tag: null }],
    });
    const state = opened({ deck: [LUNGE], actors: soloRat(), build: build(LUNGE, hasted) });
    const resolved = resolveCard(state.weave, card(LUNGE), state.build);

    // Lunge is a Light card: Weight 4, Recovery 8 (GDD §4.1).
    expect(resolved.weight).toBe(2);
    expect(resolved.recovery).toBe(5);

    const played = play(state, LUNGE).find((event) => event.kind === 'card_played');
    expect(played?.kind === 'card_played' ? played.weight : null).toBe(2);
  });

  it('never lets a Weight rider reach zero, however the gems stack', () => {
    const heavy = gem('g_free', { frame: 'HASTE', weightDelta: -99 });
    const state = opened({ deck: [LUNGE], actors: soloRat(), build: build(LUNGE, heavy) });

    expect(resolveCard(state.weave, card(LUNGE), state.build).weight).toBe(1);
  });

  it('never lets Recovery go negative', () => {
    const free = gem('g_nocd', { effects: [{ type: 'RECOVERY_DELTA', value: -99, tag: null }] });
    const state = opened({ deck: [LUNGE], actors: soloRat(), build: build(LUNGE, free) });

    expect(resolveCard(state.weave, card(LUNGE), state.build).recovery).toBe(0);
  });
});

describe('REPEAT swings the card again (GDD §6.2)', () => {
  it('lands two blows rather than one doubled one', () => {
    const repeat = gem('g_repeat', {
      frame: 'REPEAT',
      weightDelta: 2,
      effects: [
        { type: 'EXTRA_STRIKE', value: 1, tag: null },
        { type: 'DAMAGE_MULT', value: -0.35, tag: null },
      ],
    });
    const state = opened({ deck: [LUNGE], actors: soloRat(), build: build(LUNGE, repeat) });
    const blows = play(state, LUNGE).filter((event) => event.kind === 'damage_dealt');

    // Two separate blows, each 11 x 0.65 = 7. Separate matters: each is checked
    // against Poise on its own, so a split does not stagger like the whole.
    expect(blows).toHaveLength(2);
    expect(damageTo(play(state, LUNGE), RAT)).toBe(14);
  });

  it('pays for the extra swing in Weight, which is its stated drawback', () => {
    const repeat = gem('g_repeat', { frame: 'REPEAT', weightDelta: 2 });
    const state = opened({ deck: [LUNGE], actors: soloRat(), build: build(LUNGE, repeat) });

    expect(resolveCard(state.weave, card(LUNGE), state.build).weight).toBe(6);
  });
});

describe('BREAK shakes harder without hitting harder (GDD §6.2 [AMD])', () => {
  it('staggers on a blow whose damage alone would not clear the threshold', () => {
    // A tier-4 POISE_FACTOR roll, from frames.json's own range.
    const breaker = gem('g_break', {
      frame: 'BREAK',
      tier: 4,
      effects: [{ type: 'POISE_FACTOR', value: 0.6, tag: null }],
    });
    // Sweep lands 6 on a rat whose Poise threshold is 9: short on its own,
    // enough once BREAK counts it at x1.6 (GDD §4.6 is a threshold, not a pool).
    const bare = opened({ deck: [SWEEP], actors: soloRat() });
    const armed = opened({ deck: [SWEEP], actors: soloRat(), build: build(SWEEP, breaker) });

    const staggers = (events: readonly CombatEvent[]): number =>
      events.filter((event) => event.kind === 'staggered').length;

    expect(staggers(play(bare, SWEEP))).toBe(0);
    expect(staggers(play(armed, SWEEP))).toBe(1);
    // And the damage is untouched: BREAK moves the check, not the blow.
    expect(damageTo(play(bare, SWEEP), RAT)).toBe(damageTo(play(armed, SWEEP), RAT));
  });

  it('cannot make a Light card stagger a Warden, even at tier 4', () => {
    // The threshold is a real wall (GDD §12.2): the Warden is the fight you
    // solve, and a gem that let any card shake it would delete the puzzle.
    const breaker = gem('g_break', {
      frame: 'BREAK',
      tier: 4,
      effects: [{ type: 'POISE_FACTOR', value: 0.8, tag: null }],
    });
    const armed = opened({ deck: [LUNGE], actors: ratAndWarden(), build: build(LUNGE, breaker) });

    const swung = reduce(armed, { kind: 'play', card: LUNGE, target: WARDEN });
    if (!swung.ok) throw new Error('lunge refused');

    expect(swung.step.events.filter((event) => event.kind === 'staggered')).toHaveLength(0);
  });
});

describe('KINDLE converts before the Weave prices it (GDD §6.2)', () => {
  it('exposes the card to the new tag rather than the printed one', () => {
    // Crush is Shadow and the rat resists 30% of Shadow. Kindled to Physical,
    // which the rat does not resist, the same card lands its full figure.
    const kindle = gem('g_kindle', {
      frame: 'KINDLE',
      effects: [{ type: 'CONVERT_TAG', value: 0, tag: 'Physical' }],
    });
    const bare = opened({ deck: [CRUSH], actors: soloRat() });
    const armed = opened({ deck: [CRUSH], actors: soloRat(), build: build(CRUSH, kindle) });

    expect(damageTo(play(bare, CRUSH), RAT)).toBe(17);
    expect(damageTo(play(armed, CRUSH), RAT)).toBe(24);
    expect(resolveCard(armed.weave, card(CRUSH), armed.build).tag).toBe('Physical');
  });
});

describe('socket order is meaning, not an accident (docs/M1_PLAN.md D33)', () => {
  it('gives a different card for the same two gems in the other order', () => {
    const toFire = gem('g_fire', {
      frame: 'KINDLE',
      effects: [{ type: 'CONVERT_TAG', value: 0, tag: 'Fire' }],
    });
    const toFrost = gem('g_frost', {
      frame: 'KINDLE',
      effects: [{ type: 'CONVERT_TAG', value: 0, tag: 'Frost' }],
    });

    const first = resolveCard(NEUTRAL_WEAVE, card(LUNGE), build(LUNGE, toFire, toFrost));
    const second = resolveCard(NEUTRAL_WEAVE, card(LUNGE), build(LUNGE, toFrost, toFire));

    expect(first.tag).toBe('Frost');
    expect(second.tag).toBe('Fire');
  });

  it('is stable across repetitions, so a build is not a coin flip', () => {
    const loadout = build(
      LUNGE,
      gem('g_a', { effects: [{ type: 'DAMAGE_MULT', value: 0.5, tag: null }] }),
      gem('g_b', { effects: [{ type: 'DAMAGE_MULT', value: -0.2, tag: null }] }),
    );
    const once = resolveCard(NEUTRAL_WEAVE, card(LUNGE), loadout);

    for (let repeat = 0; repeat < 100; repeat += 1) {
      expect(resolveCard(NEUTRAL_WEAVE, card(LUNGE), loadout)).toEqual(once);
    }
  });
});

describe('gem data is validated at load (CLAUDE.md §3.3, §5.4)', () => {
  const VALID = {
    id: 'g_ok',
    frame: 'REPEAT',
    tier: 2,
    weightDelta: 2,
    effects: [{ type: 'EXTRA_STRIKE', value: 1 }],
  };

  it('accepts a well-formed gem', () => {
    expect(parseGemCatalogue({ gems: [VALID] }).ok).toBe(true);
  });

  it('rejects an unregistered effect, naming the gem', () => {
    const parsed = parseGemCatalogue({
      gems: [{ ...VALID, effects: [{ type: 'ASCEND', value: 1 }] }],
    });

    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? [] : parsed.errors).toEqual([
      'gem "g_ok" names unregistered effect "ASCEND"',
    ]);
  });

  it('rejects an unknown frame and an impossible tier', () => {
    expect(parseGemCatalogue({ gems: [{ ...VALID, frame: 'ASCEND' }] }).ok).toBe(false);
    expect(parseGemCatalogue({ gems: [{ ...VALID, tier: 7 }] }).ok).toBe(false);
  });

  it('catches an atom whose parameter is wrong, not just its type', () => {
    // CONVERT_TAG is registered and the value is a number, so this type-checks
    // and would otherwise throw the first time the card was swung.
    const parsed = parseGemCatalogue({
      gems: [{ ...VALID, frame: 'KINDLE', effects: [{ type: 'CONVERT_TAG', value: 0 }] }],
    });

    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? '' : parsed.errors[0]).toContain('does not resolve');
  });

  it('rejects a tag outside the taxonomy', () => {
    const parsed = parseGemCatalogue({
      gems: [{ ...VALID, effects: [{ type: 'CONVERT_TAG', value: 0, tag: 'Radiant' }] }],
    });

    expect(parsed.ok).toBe(false);
  });
});

describe('the frame table (GDD §6.2)', () => {
  it('loads, and every frame it names is one of the ten', () => {
    for (const recipe of Object.values(frameTable())) {
      expect(FRAMES).toContain(recipe.id);
    }
  });

  it('gives every frame a real drawback — §6.2 and §10 both require one', () => {
    for (const recipe of Object.values(frameTable())) {
      expect(recipe.drawback.length).toBeGreaterThan(0);
    }
  });

  it('rolls only atoms that are actually registered', () => {
    for (const recipe of Object.values(frameTable())) {
      for (const roll of recipe.rolls) expect(isRegisteredEffect(roll.type)).toBe(true);
    }
  });

  it('gives every roll four tiers, low never above high', () => {
    const ranges = Object.values(frameTable()).flatMap((recipe) =>
      recipe.rolls.flatMap((roll) =>
        GEM_TIERS.map((tier) => ({ frame: recipe.id, type: roll.type, ...rangeAt(roll, tier) })),
      ),
    );

    expect(ranges.length).toBeGreaterThan(0);
    for (const range of ranges) {
      expect(range.low, `${range.frame}/${range.type}`).toBeLessThanOrEqual(range.high);
    }
  });

  it('refuses a frame that states no drawback', () => {
    const parsed = parseFrameTable({
      frames: [{ id: 'REPEAT', effect: 'strikes twice', drawback: '', rolls: [] }],
    });

    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? [] : parsed.errors).toEqual(['frame "REPEAT" states no drawback']);
  });
});
