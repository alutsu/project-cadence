import { describe, expect, it } from 'vitest';
import { m0Catalogue, m0Deck, parseCardCatalogue, parseDeck } from '../../src/data/cards.ts';
import { TAGS } from '../../src/sim/tag.ts';
import { WEIGHT_CLASSES } from '../../src/sim/weightClass.ts';

const VALID_CARD = { id: 'strike', name: 'Strike', class: 'light', damage: 9, tag: 'Physical' };

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
    // and Recovery (GDD §4.1), so before the Weave lands two cards sharing
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

/**
 * docs/M1_PLAN.md D15, D16. The taxonomy is closed, so an unknown tag is a typo
 * and not an extension — and a card the Weave cannot price is a card the player
 * cannot read before committing (P3). The deck assertions guard the property the
 * Attunement roll depends on rather than the particular assignment, which is
 * inherited from M0 and expected to move at the S8 balance pass.
 */
describe('card tags (GDD §7, docs/M1_PLAN.md D15)', () => {
  it('rejects a tag outside the taxonomy, naming the card', () => {
    const parsed = parseCardCatalogue({ cards: [{ ...VALID_CARD, tag: 'Radiant' }] });

    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? [] : parsed.errors).toEqual(['card "strike" has an unknown tag: "Radiant"']);
  });

  it('rejects the mechanical words §6.2 also calls tags', () => {
    const parsed = parseCardCatalogue({ cards: [{ ...VALID_CARD, tag: 'Multi' }] });

    expect(parsed.ok).toBe(false);
  });

  it('gives every card in the catalogue exactly one tag', () => {
    for (const card of Object.values(m0Catalogue())) {
      expect(TAGS).toContain(card.tag);
    }
  });

  it('spreads the deck over enough tags that an Attunement roll can miss', () => {
    const catalogue = m0Catalogue();
    const used = new Set(m0Deck(catalogue).map((id) => catalogue[id]?.tag));

    // §7.1 raises two tags and pushes two down. A deck sitting on four or fewer
    // tags has no slack: every card moves on every roll, and the choice the
    // Weave exists to create collapses into a flat rescaling.
    expect(used.size).toBeGreaterThan(4);
  });
});
