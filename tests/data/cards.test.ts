import { describe, expect, it } from 'vitest';
import { m0Catalogue, parseCardCatalogue } from '../../src/data/cards.ts';
import { WEIGHT_CLASSES } from '../../src/sim/weightClass.ts';

const VALID_CARD = { id: 'strike', name: 'Strike', class: 'light', damage: 9, tags: ['Physical'] };

describe('card data validation (CLAUDE.md §3.3)', () => {
  it('inherits Weight and Recovery from the class table, never from the card', () => {
    const parsed = parseCardCatalogue({ cards: [VALID_CARD] });
    if (!parsed.ok) throw new Error(parsed.errors.join(', '));

    expect(parsed.value.strike).toMatchObject({
      weight: WEIGHT_CLASSES.light.weight,
      recovery: WEIGHT_CLASSES.light.recovery,
    });
  });

  it('rejects an unknown Weight class by name', () => {
    const parsed = parseCardCatalogue({ cards: [{ ...VALID_CARD, class: 'colossal' }] });

    expect(parsed).toEqual({
      ok: false,
      errors: ['card "strike" has an unknown Weight class: colossal'],
    });
  });

  it('rejects malformed cards and names each one', () => {
    const parsed = parseCardCatalogue({
      cards: [{ ...VALID_CARD, id: 'a', damage: -1 }, 'not-a-card'],
    });

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors).toEqual(['card "a" has invalid damage: -1', 'card 1 is not an object']);
  });

  it('rejects duplicate ids, which would silently shadow a card', () => {
    const parsed = parseCardCatalogue({ cards: [VALID_CARD, VALID_CARD] });

    expect(parsed).toEqual({ ok: false, errors: ['duplicate card ids: strike'] });
  });

  it('rejects data with no cards array at all', () => {
    expect(parseCardCatalogue({}).ok).toBe(false);
    expect(parseCardCatalogue(null).ok).toBe(false);
  });
});

describe('the provisional M0 deck (GDD §5.1 [AMD], plan D1)', () => {
  it('loads, and holds the twelve cards the plan specifies', () => {
    const catalogue = m0Catalogue();
    const byClass = Object.values(catalogue).reduce<Record<string, number>>(
      (tally, card) => ({ ...tally, [card.weightClass]: (tally[card.weightClass] ?? 0) + 1 }),
      {},
    );

    expect(Object.keys(catalogue)).toHaveLength(12);
    expect(byClass).toEqual({ light: 5, standard: 4, heavy: 2, ultimate: 1 });
  });
});
