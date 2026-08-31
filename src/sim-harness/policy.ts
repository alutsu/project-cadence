import type { Action } from '../sim/actions.ts';
import { isAlive, type Actor } from '../sim/actor.ts';
import { findCard, type CardDefinition } from '../sim/card.ts';
import type { CardId } from '../sim/ids.ts';
import { livingEnemies, type CombatState } from '../sim/state.ts';
import { damagePerTarget } from '../sim/targeting.ts';

/**
 * Scripted policy agents (GDD §19, CLAUDE.md §7.3). Deliberately stupid: they
 * exist to measure the shape of an encounter, not to play it well. None of them
 * Waits for Guard or Staggers on purpose, so a competent human should beat every
 * number they produce — read them as a floor, never as the difficulty itself.
 */
export type Policy = (state: CombatState) => Action;

export interface NamedPolicy {
  readonly name: string;
  readonly play: Policy;
}

function firstLivingEnemy(state: CombatState) {
  return state.actors.find((actor) => actor.side === 'enemy' && isAlive(actor));
}

/**
 * What a card would actually put on the board this turn, across everything it
 * reaches.
 *
 * `card.damage` is neither what one enemy takes nor what the swing is worth once
 * a card can hit the whole line (GDD §4.8): scoring on it rates Cleave as a
 * Hammerfall against one enemy and undervalues it against three, which would
 * make every number this harness prints a measurement of the wrong game.
 */
function expectedDamage(state: CombatState, card: CardDefinition): number {
  const reach = card.targeting === 'all' ? livingEnemies(state).length : 1;
  return damagePerTarget(card) * reach;
}

/** The lowest-HP living enemy — the target a human picks to cut incoming damage. */
function weakestLivingEnemy(state: CombatState) {
  return livingEnemies(state).reduce<Actor | undefined>(
    (chosen, actor) => (chosen === undefined || actor.hp < chosen.hp ? actor : chosen),
    undefined,
  );
}

function handCards(state: CombatState): readonly CardDefinition[] {
  return state.hand
    .map((id) => findCard(state.catalogue, id))
    .filter((card): card is CardDefinition => card !== undefined);
}

/** Picks by a score over the cards in hand, or Waits when the hand cannot act. */
function choose(state: CombatState, score: (card: CardDefinition) => number): Action {
  const target = firstLivingEnemy(state);
  if (target === undefined) return { kind: 'guard' };

  let best: { readonly card: CardId; readonly score: number } | null = null;
  for (const card of handCards(state)) {
    const value = score(card);
    if (best === null || value > best.score) best = { card: card.id, score: value };
  }

  return best === null ? { kind: 'guard' } : { kind: 'play', card: best.card, target: target.id };
}

/**
 * The floor: play hand slot 0 every turn, ignoring what is in it. This is what a
 * player does before the queue has taught them anything, so the gap between it
 * and `tempo` is the clearest measure of whether choosing is worth anything.
 */
export const leftmost: Policy = (state) => {
  const target = firstLivingEnemy(state);
  const card = state.hand[0];
  if (target === undefined || card === undefined) return { kind: 'guard' };
  return { kind: 'play', card, target: target.id };
};

/** Greedy damage: the biggest number in hand, whatever it costs in the queue. */
export const greedyDamage: Policy = (state) => choose(state, (card) => expectedDamage(state, card));

/** Greedy tempo: the best damage per tick of Weight — the queue-aware choice. */
export const tempo: Policy = (state) =>
  choose(state, (card) => expectedDamage(state, card) / card.weight);

/**
 * Tempo, but killing the weakest enemy first. Every other policy hits whatever
 * stands in front, which badly understates a multi-enemy fight — removing an
 * actor removes its whole share of incoming damage (GDD §4.8). Read the gap
 * between this and `tempo` as the value of choosing a target.
 */
export const focus: Policy = (state) => {
  const target = weakestLivingEnemy(state);
  if (target === undefined) return { kind: 'guard' };

  let best: { readonly card: CardId; readonly score: number } | null = null;
  for (const card of handCards(state)) {
    const score = expectedDamage(state, card) / card.weight;
    if (best === null || score > best.score) best = { card: card.id, score };
  }
  return best === null ? { kind: 'guard' } : { kind: 'play', card: best.card, target: target.id };
};

export const POLICIES: readonly NamedPolicy[] = [
  { name: 'leftmost', play: leftmost },
  { name: 'greedy', play: greedyDamage },
  { name: 'tempo', play: tempo },
  { name: 'focus', play: focus },
];
