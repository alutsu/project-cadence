import { describe, expect, it } from 'vitest';
import { m0Catalogue } from '../../src/data/cards.ts';
import { PLAYER, RAT, ratAndWarden, soloRat, WARDEN } from '../../src/data/encounters.ts';
import { advanceToDecision, reduce, startCombat } from '../../src/sim/combat.ts';
import type { CombatEvent } from '../../src/sim/events.ts';
import { cardId, type CardId } from '../../src/sim/ids.ts';
import { createRng } from '../../src/sim/rng.ts';
import { DEFAULT_RULES, type UltimateRule } from '../../src/sim/rules.ts';
import { findActor, type CombatState } from '../../src/sim/state.ts';
import { advanceTime } from '../../src/sim/effects.ts';
import { tick } from '../../src/sim/tick.ts';
import { previewAction } from '../../src/sim/forecast.ts';
import { damageAgainst } from '../../src/sim/strike.ts';
import { NEUTRAL_WEAVE, type WeaveSnapshot } from '../../src/sim/weave.ts';
import type { Tag } from '../../src/sim/tag.ts';

/**
 * One damage path (docs/M1_PLAN.md D27).
 *
 * M0 had two, and they disagreed: an immediate strike applied Empower and
 * Weaken, a wind-up Ultimate snapshotted a bare number at commit and skipped
 * them. Nothing caught it because nothing compared them. These tests do.
 */

const CATALOGUE = m0Catalogue();
const CATACLYSM = cardId('cataclysm');
const CRUSH = cardId('crush');
const LUNGE = cardId('lunge');

function opened(options: {
  readonly deck: readonly CardId[];
  readonly actors: ReturnType<typeof soloRat>;
  readonly ultimate?: UltimateRule;
  readonly weave?: WeaveSnapshot;
}): CombatState {
  const started = startCombat({
    actors: options.actors,
    catalogue: CATALOGUE,
    deck: options.deck,
    rng: createRng(1, 'combat'),
    rules: { ...DEFAULT_RULES, ultimate: options.ultimate ?? 'immediate' },
    weave: options.weave ?? NEUTRAL_WEAVE,
  });
  return advanceToDecision(started.state).state;
}

function empowered(state: CombatState, magnitude: number): CombatState {
  return {
    ...state,
    actors: state.actors.map((actor) =>
      actor.id === PLAYER
        ? {
            ...actor,
            statuses: [{ kind: 'empower' as const, magnitude, expiresAt: null, nextProcAt: null }],
          }
        : { ...actor, hp: 500, maxHp: 500 },
    ),
  };
}

type DamageEvent = Extract<CombatEvent, { kind: 'damage_dealt' }>;

function damageEvents(events: readonly CombatEvent[]): readonly DamageEvent[] {
  return events.filter((event): event is DamageEvent => event.kind === 'damage_dealt');
}

function damageTo(events: readonly CombatEvent[], target: string): number {
  return damageEvents(events)
    .filter((event) => event.target === target)
    .reduce((total, event) => total + event.amount, 0);
}

/** Plays the card and runs time far enough for a wind-up to have landed. */
function playThrough(state: CombatState, card: CardId): readonly CombatEvent[] {
  const result = reduce(state, { kind: 'play', card, target: RAT });
  if (!result.ok) throw new Error(`refused: ${result.error.reason}`);

  const settled = advanceTime(result.step.state, tick(result.step.state.now + 40));
  return [...result.step.events, ...settled.events];
}

describe('the two damage paths agree (docs/M1_PLAN.md D27)', () => {
  it('applies Empower to a wind-up Ultimate, which M0 silently did not', () => {
    const base = opened({ deck: [CATACLYSM], actors: soloRat() });

    const immediate = damageTo(playThrough(empowered(base, 0.5), CATACLYSM), RAT);
    const windup = damageTo(
      playThrough(
        empowered({ ...base, rules: { ...base.rules, ultimate: 'windup' } }, 0.5),
        CATACLYSM,
      ),
      RAT,
    );

    // Cataclysm lands 26 per enemy; +50% Empower makes it 39 either way.
    expect(immediate).toBe(39);
    expect(windup).toBe(immediate);
  });

  it('prices a wind-up against the Weave, not against a frozen number', () => {
    const suppressed: WeaveSnapshot = {
      attunement: { ...NEUTRAL_WEAVE.attunement, Fire: 'suppressed' },
      saturation: NEUTRAL_WEAVE.saturation,
    };
    const state = opened({
      deck: [CATACLYSM],
      actors: soloRat(),
      ultimate: 'windup',
      weave: suppressed,
    });

    // Cataclysm is Fire. Suppressed is x0.70, so 26 becomes 18.
    expect(damageTo(playThrough(empowered(state, 0), CATACLYSM), RAT)).toBe(18);
  });
});

describe('the Weave reaches damage exactly once (GDD §7)', () => {
  it('applies the defender resistance and nothing else', () => {
    const state = opened({ deck: [CRUSH], actors: soloRat() });

    // Crush is Shadow and prints 24; the rat shrugs off 30% of Shadow.
    expect(damageTo(playThrough(state, CRUSH), RAT)).toBe(Math.round(24 * 0.7));
  });

  it('leaves a tag no one resists at its printed figure', () => {
    const state = opened({ deck: [LUNGE], actors: soloRat() });

    // Lunge is Physical and the rat resists none of it.
    expect(damageTo(playThrough(state, LUNGE), RAT)).toBe(11);
  });

  it('costs one tick less on an Ascendant tag, and one more when Suppressed (§7.1)', () => {
    const weights = (attunement: 'ascendant' | 'neutral' | 'suppressed'): number => {
      const weave: WeaveSnapshot = {
        attunement: { ...NEUTRAL_WEAVE.attunement, Physical: attunement },
        saturation: NEUTRAL_WEAVE.saturation,
      };
      const state = opened({ deck: [LUNGE], actors: soloRat(), weave });
      const result = reduce(state, { kind: 'play', card: LUNGE, target: RAT });
      if (!result.ok) throw new Error('refused');
      const played = result.step.events.find((event) => event.kind === 'card_played');
      return played?.kind === 'card_played' ? played.weight : Number.NaN;
    };

    // Lunge is a Light card: Weight 4 (GDD §4.1), then the §7.1 rider.
    expect(weights('neutral')).toBe(4);
    expect(weights('ascendant')).toBe(3);
    expect(weights('suppressed')).toBe(5);
  });
});

describe('an AoE is priced per defender, not once for the line (GDD §7.2, §4.8)', () => {
  it('lands different figures on enemies that resist differently', () => {
    const state = opened({ deck: [CRUSH], actors: ratAndWarden() });
    const events = playThrough(state, CRUSH);

    // Crush is single-target, so only the chosen enemy is struck at all.
    expect(damageTo(events, WARDEN)).toBe(0);
    expect(damageTo(events, RAT)).toBeGreaterThan(0);
  });

  it('previews an AoE across mixed resistances exactly as it commits', () => {
    // The M1-only divergence case: one card, two defenders, two multipliers,
    // and a rounding on each. An estimator would drift here first.
    const cataclysm = opened({ deck: [CATACLYSM], actors: ratAndWarden() });
    const preview = previewAction(cataclysm, { kind: 'play', card: CATACLYSM, target: RAT });
    if (preview === null) throw new Error('cataclysm should be legal');

    const result = reduce(cataclysm, { kind: 'play', card: CATACLYSM, target: RAT });
    if (!result.ok) throw new Error('cataclysm refused');

    const landed = damageEvents(result.step.events).map((event) => ({
      target: event.target,
      amount: event.amount,
    }));

    expect(preview.hits).toEqual(landed);
    expect(new Set(preview.hits.map((hit) => hit.amount)).size).toBeGreaterThan(0);
  });
});

describe('the event log carries what a blow was made of (docs/M1_PLAN.md D28)', () => {
  it('tags the player’s damage and leaves an enemy intent untagged', () => {
    const state = opened({ deck: [LUNGE], actors: soloRat() });
    const blows = damageEvents(playThrough(state, LUNGE));
    const mine: readonly (Tag | null)[] = blows
      .filter((event) => event.source === PLAYER)
      .map((event) => event.tag);

    expect(mine).toContain('Physical');
    for (const event of blows.filter((blow) => blow.source !== PLAYER)) {
      expect(event.tag).toBeNull();
    }
  });
});

describe('the Weight floor (docs/M1_PLAN.md D17)', () => {
  it('never lets a rider drive a card to zero Weight', () => {
    const weave: WeaveSnapshot = {
      attunement: { ...NEUTRAL_WEAVE.attunement, Physical: 'ascendant' },
      saturation: NEUTRAL_WEAVE.saturation,
    };
    const state = opened({ deck: [LUNGE], actors: soloRat(), weave });
    const before = findActor(state, PLAYER)?.nextActTick ?? 0;

    const result = reduce(state, { kind: 'play', card: LUNGE, target: RAT });
    if (!result.ok) throw new Error('refused');

    // Weight 3 rather than 4, but still a real cost: a Weight of 0 is a delay
    // of 0, and an actor that acts again on the tick it just acted never stops.
    expect(findActor(result.step.state, PLAYER)?.nextActTick ?? 0).toBeGreaterThan(before);
  });
});

/**
 * GDD §15: hovering a card shows post-Weave damage against the current target,
 * not base damage. The card face reads this function rather than the card, so
 * these assertions are what stops the screen from printing 24 for a blow that
 * lands 17 (P3 — a computed value the player cannot see is a design bug).
 */
describe('what the card face is allowed to print (GDD §15, P3)', () => {
  it('prices the card against the enemy the player is actually pointing at', () => {
    const state = opened({ deck: [CRUSH], actors: ratAndWarden() });

    // Crush is Shadow. The rat resists 30% of it; the Warden resists none.
    expect(damageAgainst(state, CATALOGUE[CRUSH] ?? never(), RAT)).toBe(17);
    expect(damageAgainst(state, CATALOGUE[CRUSH] ?? never(), WARDEN)).toBe(24);
  });

  it('agrees exactly with what the blow then deals', () => {
    const state = opened({ deck: [CRUSH], actors: ratAndWarden() });
    const shown = damageAgainst(state, CATALOGUE[CRUSH] ?? never(), RAT);

    expect(damageTo(playThrough(state, CRUSH), RAT)).toBe(shown);
  });

  it('falls back to the front of the line when nothing is targeted yet', () => {
    const state = opened({ deck: [CRUSH], actors: soloRat() });

    expect(damageAgainst(state, CATALOGUE[CRUSH] ?? never(), null)).toBe(17);
  });
});

function never(): never {
  throw new Error('missing card');
}
