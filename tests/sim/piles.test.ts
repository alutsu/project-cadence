import { describe, expect, it } from 'vitest';
import { m0Catalogue, m0Deck } from '../../src/data/cards.ts';
import { soloRat } from '../../src/data/encounters.ts';
import type { Action } from '../../src/sim/actions.ts';
import { advanceToDecision, reduce, startCombat, type CombatStep } from '../../src/sim/combat.ts';
import { cardId, type CardId } from '../../src/sim/ids.ts';
import {
  HAND_CAP,
  OPENING_HAND,
  drawOne,
  hasPlayableCard,
  returnDueCards,
  shuffle,
} from '../../src/sim/piles.ts';
import { createRng } from '../../src/sim/rng.ts';
import type { CombatState } from '../../src/sim/state.ts';
import { tick } from '../../src/sim/tick.ts';

const CATALOGUE = m0Catalogue();
/** The authored twelve, not one of each: a hand-full test needs the depth. */
const ALL_CARDS: readonly CardId[] = m0Deck(CATALOGUE);
const CRUSH = cardId('crush');
const LUNGE = cardId('lunge');

function opened(deck: readonly CardId[], seed = 1): CombatState {
  const started = startCombat({
    actors: soloRat(),
    catalogue: CATALOGUE,
    deck,
    rng: createRng(seed, 'combat'),
  });
  return advanceToDecision(started.state).state;
}

function commit(state: CombatState, action: Action): CombatStep {
  const result = reduce(state, action);
  if (!result.ok) throw new Error(`action refused: ${result.error.reason}`);
  const advanced = advanceToDecision(result.step.state);
  return { state: advanced.state, events: [...result.step.events, ...advanced.events] };
}

describe('the opening hand (GDD §4.9, plan D12)', () => {
  it('deals five, leaving one space under the cap for the turn draw', () => {
    const state = opened(ALL_CARDS);

    expect(state.hand).toHaveLength(OPENING_HAND + 1);
    expect(state.hand.length).toBeLessThanOrEqual(HAND_CAP);
    expect(state.draw).toHaveLength(ALL_CARDS.length - state.hand.length);
  });

  it('shuffles from the injected stream, so a seed reproduces the deal', () => {
    expect(opened(ALL_CARDS, 42).hand).toEqual(opened(ALL_CARDS, 42).hand);
    expect(shuffle(ALL_CARDS, createRng(7, 'combat'))).not.toEqual(ALL_CARDS);
  });

  it('keeps every card — a shuffle reorders and never loses', () => {
    const shuffled = shuffle(ALL_CARDS, createRng(9, 'combat'));
    expect([...shuffled].sort()).toEqual([...ALL_CARDS].sort());
  });
});

describe('the Cooldown pile (GDD §4.9)', () => {
  it('holds a Heavy card for its full Recovery of 26 ticks, and says so in advance', () => {
    const target = soloRat()[1]?.id;
    if (target === undefined) throw new Error('no enemy');
    const played = commit(opened([CRUSH]), { kind: 'play', card: CRUSH, target });

    // Played at t6 with Recovery 26 (GDD §4.1): due back at t32, and the entry
    // is visible from the moment it is played.
    expect(played.state.hand).not.toContain(CRUSH);
    expect(played.state.cooldown).toContainEqual({ card: CRUSH, returnTick: 32 });
    expect(played.state.draw).not.toContain(CRUSH);
  });

  it('returns a card to the bottom of the draw pile, never the top', () => {
    const state = opened(ALL_CARDS);
    const cooling = { ...state, cooldown: [{ card: CRUSH, returnTick: tick(20) }] };

    const early = returnDueCards(cooling, tick(19));
    expect(early.state.cooldown).toHaveLength(1);
    expect(early.state.draw).toEqual(state.draw);

    const due = returnDueCards(cooling, tick(20));
    expect(due.state.cooldown).toHaveLength(0);
    expect(due.state.draw.at(-1)).toBe(CRUSH);
    expect(due.events).toEqual([expect.objectContaining({ kind: 'card_returned', card: CRUSH })]);
  });

  it('makes a played card playable again once its Recovery elapses', () => {
    const target = soloRat()[1]?.id;
    if (target === undefined) throw new Error('no enemy');

    // Strike: Weight 4, Recovery 8. Played at t6, due back at t14.
    let state = commit(opened([LUNGE]), { kind: 'play', card: LUNGE, target }).state;
    expect(state.hand).not.toContain(LUNGE);

    while (state.now < 14 && state.outcome === 'ongoing') {
      state = commit(state, { kind: 'wait' }).state;
    }

    expect(state.cooldown).toHaveLength(0);
    expect(state.hand).toContain(LUNGE);
  });

  it('never reshuffles early — an empty pile simply draws nothing', () => {
    const state = opened([LUNGE]);
    const target = soloRat()[1]?.id;
    if (target === undefined) throw new Error('no enemy');

    const played = commit(state, { kind: 'play', card: LUNGE, target });

    expect(played.state.hand).toHaveLength(0);
    expect(played.state.draw).toHaveLength(0);
    expect(played.events).toContainEqual(
      expect.objectContaining({ kind: 'draw_skipped', reason: 'draw_pile_empty' }),
    );
  });
});

describe('two copies of one card (GDD §5.1)', () => {
  it('plays one and leaves the other in hand, each on its own clock', () => {
    // The M0 deck holds three Lunges. Every pile is keyed by card id, so this
    // is the case where that could quietly collapse two cards into one.
    const state = opened([LUNGE, LUNGE]);
    const target = state.actors.find((actor) => actor.side === 'enemy');
    if (target === undefined) throw new Error('no enemy to strike');
    expect(state.hand).toEqual([LUNGE, LUNGE]);

    const played = commit(state, { kind: 'play', card: LUNGE, target: target.id });

    expect(played.state.hand).toEqual([LUNGE]);
    expect(played.state.cooldown).toHaveLength(1);
  });

  it('returns them one at a time, in the order they were spent', () => {
    const recovery = CATALOGUE.lunge?.recovery;
    if (recovery === undefined) throw new Error('lunge is not in the catalogue');
    const cooling = {
      ...opened([LUNGE, LUNGE]),
      cooldown: [
        { card: LUNGE, returnTick: tick(10) },
        { card: LUNGE, returnTick: tick(20) },
      ],
    };

    const early = returnDueCards(cooling, tick(10));

    expect(early.state.cooldown).toEqual([{ card: LUNGE, returnTick: 20 }]);
    expect(early.state.draw.filter((card) => card === LUNGE)).toHaveLength(
      cooling.draw.filter((card) => card === LUNGE).length + 1,
    );
  });
});

describe('drawing (GDD §4.1, §4.3)', () => {
  it('skips the draw when the hand is full, leaving the card on top', () => {
    const state = opened(ALL_CARDS);
    const full = { ...state, hand: state.draw.slice(0, HAND_CAP) };
    const drawn = drawOne(full);

    expect(drawn.state.hand).toEqual(full.hand);
    expect(drawn.state.draw).toEqual(full.draw);
    expect(drawn.events).toEqual([
      expect.objectContaining({ kind: 'draw_skipped', reason: 'hand_full' }),
    ]);
  });

  it('gives Wait its own card, on top of the turn draw (plan D13)', () => {
    const opening = opened(ALL_CARDS);
    // The turn draw already filled the hand to the cap, so make room first —
    // Wait's draw is an extra one, not a replacement for the turn draw.
    const state = { ...opening, hand: opening.hand.slice(0, 2) };
    const waited = reduce(state, { kind: 'wait' });
    if (!waited.ok) throw new Error('wait is always legal');

    expect(waited.step.state.hand).toHaveLength(3);
    expect(waited.step.events).toContainEqual(expect.objectContaining({ kind: 'card_drawn' }));
  });

  it('fills the hand to the cap on the opening turn, so Wait cannot overdraw', () => {
    const state = opened(ALL_CARDS);
    const waited = reduce(state, { kind: 'wait' });
    if (!waited.ok) throw new Error('wait is always legal');

    expect(state.hand).toHaveLength(HAND_CAP);
    expect(waited.step.state.hand).toHaveLength(HAND_CAP);
    expect(waited.step.events).toContainEqual(
      expect.objectContaining({ kind: 'draw_skipped', reason: 'hand_full' }),
    );
  });
});

describe('the auto-Wait condition (GDD §4.3)', () => {
  it('reports no playable card when the hand is empty', () => {
    expect(hasPlayableCard([], CATALOGUE)).toBe(false);
  });

  it('reports a playable card whenever the hand holds one', () => {
    expect(hasPlayableCard([LUNGE], CATALOGUE)).toBe(true);
  });
});
