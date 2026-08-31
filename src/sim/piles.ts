import type { CardCatalogue } from './card.ts';
import { findCard } from './card.ts';
import type { CardId } from './ids.ts';
import type { Rng } from './rng.ts';
import type { CombatState, CombatStep, CooldownEntry } from './state.ts';
import { addTicks, type Tick } from './tick.ts';

/** GDD §4.1: the hand holds six cards. */
export const HAND_CAP = 6;

/**
 * [AMD] The opening hand. The GDD never states one: §3's loop draws 1 at the
 * start of each player turn, which would open a fight holding a single card.
 * Five leaves exactly one space under the cap, so the first turn's draw is a
 * real draw rather than one skipped against a full hand (D4).
 */
export const OPENING_HAND = 5;

/** Fisher-Yates over an injected stream — never Math.random (GDD §20.2). */
export function shuffle(cards: readonly CardId[], rng: Rng): readonly CardId[] {
  const shuffled = [...cards];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = rng.nextInt(index + 1);
    const here = shuffled[index];
    const there = shuffled[swap];
    if (here === undefined || there === undefined) continue;
    shuffled[index] = there;
    shuffled[swap] = here;
  }
  return shuffled;
}

/**
 * Draws one card (GDD §4.1).
 *
 * Two ways to draw nothing, and both are deliberate: a full hand skips the draw
 * and leaves the card on top of the pile (§4.3 [AMD]), and an empty draw pile
 * draws nothing at all — the wait is the cost, and the Cooldown pile is never
 * reshuffled early (§4.9).
 */
export function drawOne(state: CombatState): CombatStep {
  if (state.hand.length >= HAND_CAP) {
    return { state, events: [{ kind: 'draw_skipped', at: state.now, reason: 'hand_full' }] };
  }

  const [top, ...rest] = state.draw;
  if (top === undefined) {
    return { state, events: [{ kind: 'draw_skipped', at: state.now, reason: 'draw_pile_empty' }] };
  }

  return {
    state: { ...state, draw: rest, hand: [...state.hand, top] },
    events: [{ kind: 'card_drawn', at: state.now, card: top }],
  };
}

export interface CooldownOrder {
  readonly card: CardId;
  /**
   * Taken rather than looked up: Recovery moves (GDD §6.2's HASTE and ECHO
   * frames), so the printed number on the card is not necessarily the clock the
   * card is actually on. The caller has already resolved it once, and resolving
   * it a second time here is how the two would come to disagree.
   */
  readonly recovery: Tick;
}

/** Moves a played card out of hand and onto its Recovery clock (GDD §4.9). */
export function sendToCooldown(state: CombatState, order: CooldownOrder): CombatStep {
  const { card, recovery } = order;
  const returnTick = addTicks(state.now, recovery);
  const at = state.hand.indexOf(card);
  const hand = at === -1 ? state.hand : [...state.hand.slice(0, at), ...state.hand.slice(at + 1)];

  return {
    state: { ...state, hand, cooldown: [...state.cooldown, { card, returnTick }] },
    events: [{ kind: 'card_cooled', at: state.now, card, returnTick }],
  };
}

/**
 * Returns every card whose Recovery has elapsed, to the **bottom** of the draw
 * pile (GDD §4.9). Resolved by the scheduler between turns, in tick order, so a
 * card due exactly on your turn is back before you draw.
 */
export function returnDueCards(state: CombatState, through: Tick): CombatStep {
  const due = state.cooldown.filter((entry) => entry.returnTick <= through).sort(byReturnTick);
  if (due.length === 0) return { state, events: [] };

  const held = state.cooldown.filter((entry) => entry.returnTick > through);
  return {
    state: { ...state, cooldown: held, draw: [...state.draw, ...due.map((entry) => entry.card)] },
    events: due.map((entry) => ({ kind: 'card_returned', at: entry.returnTick, card: entry.card })),
  };
}

function byReturnTick(left: CooldownEntry, right: CooldownEntry): number {
  return left.returnTick - right.returnTick;
}

/** Whether any card in hand could legally be played right now. */
export function hasPlayableCard(hand: readonly CardId[], catalogue: CardCatalogue): boolean {
  return hand.some((card) => findCard(catalogue, card) !== undefined);
}
