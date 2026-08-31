import { describe, expect, it } from 'vitest';
import { m0Catalogue, m0Deck, parseCardCatalogue, parseDeck } from '../../src/data/cards.ts';
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
  it('holds one card per Weight class and reach, and no second one', () => {
    const catalogue = m0Catalogue();
    const buckets = Object.values(catalogue).map((card) => `${card.weightClass}/${card.targeting}`);

    // M0 has three axes: Weight class, damage and reach. A class fixes Weight
    // and Recovery (GDD §4.1) and tags are inert until M1, so two cards sharing
    // a class and a reach differ only in damage — and the smaller one is never
    // the right play. One per bucket is the most a non-dominated M0 deck can
    // hold, and this is the test that keeps a thirteenth from creeping back.
    expect(new Set(buckets).size).toBe(buckets.length);
  });

  it('deals the twelve the player holds out of those seven', () => {
    const catalogue = m0Catalogue();
    const deck = m0Deck(catalogue);
    const byClass = deck.reduce<Record<string, number>>((tally, id) => {
      const card = catalogue[id];
      if (card === undefined)
        throw new Error(`deck names a card that is not in the catalogue: ${id}`);
      return { ...tally, [card.weightClass]: (tally[card.weightClass] ?? 0) + 1 };
    }, {});

    expect(Object.keys(catalogue)).toHaveLength(7);
    expect(deck).toHaveLength(12);
    // The Weight curve the twelve-distinct deck had, kept exactly: most turns
    // offer a cheap option, and the Ultimate is a once-a-fight decision.
    expect(byClass).toEqual({ light: 5, standard: 4, heavy: 2, ultimate: 1 });
  });

  it('refuses a deck slot naming a card that does not exist', () => {
    const parsed = parseDeck({ deck: ['lunge', 'trebuchet'] }, m0Catalogue());

    expect(parsed).toEqual({
      ok: false,
      errors: ['deck slot 1 names no card: "trebuchet"'],
    });
  });
});
