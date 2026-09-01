import { grantMaterial, MATERIAL_NAMES } from './materials.ts';
import { materialPrice, removalPrice } from './economy.ts';
import type { GemTier } from '../sim/gem.ts';
import type { CardId } from '../sim/ids.ts';
import { SIGNATURE_CARD, type RunState } from './RunState.ts';
import { socketsOf } from './socket.ts';

/**
 * The Market (GDD §9, §11).
 *
 * §11 offers one per Depth against two Dungeons and a Sanctum, and §2's P1 is
 * why that is a real choice: taking it spends one of the two nodes a Depth
 * grants, so gold is never free — it is paid for in the fight you did not have
 * and the XP you did not earn.
 *
 * Two shelves here. Relics are §10's and are the next sprint's; the node says
 * so rather than pretending the shelf is empty.
 */

export type MarketRefusal =
  | { readonly reason: 'no-price'; readonly detail: string }
  | { readonly reason: 'too-poor'; readonly price: number }
  | { readonly reason: 'ladder-spent' }
  | { readonly reason: 'deck-floor' }
  | { readonly reason: 'signature' }
  | { readonly reason: 'not-in-deck' };

export type MarketResult =
  | { readonly ok: true; readonly run: RunState }
  | { readonly ok: false; readonly refusal: MarketRefusal };

/**
 * §5.1 starts the player on four starters plus a signature. Removal may not
 * take the deck below those four: at three the hand cap of six and the Cooldown
 * pile stop meaning anything, and every turn collapses into Guard (§4.9).
 *
 * The GDD does not state this floor — §9 prices removal and never bounds it —
 * so it is a decision recorded here and in the GDD rather than a reading of
 * one (CLAUDE.md §1.1).
 */
export const DECK_FLOOR = 4;

/** §9: 40 (T1) / 90 (T2) / 200 (T3). A Sigil is earned, never bought. */
export function buyMaterial(run: RunState, tier: GemTier): MarketResult {
  const price = materialPrice(tier);
  if (price === null) {
    return {
      ok: false,
      refusal: {
        reason: 'no-price',
        detail: `a ${MATERIAL_NAMES[tier]} is upgraded to, never sold`,
      },
    };
  }
  if (run.gold < price) return { ok: false, refusal: { reason: 'too-poor', price } };

  return {
    ok: true,
    run: { ...run, gold: run.gold - price, materials: grantMaterial(run.materials, tier) },
  };
}

/**
 * §9: card removal at 60 → 120 → 240 → 480, escalating within the run.
 *
 * Anything socketed into the card goes with it. §6.2 already destroys a gem on
 * removal from a socket, so a card leaving the deck taking its gems is the same
 * rule and not a new one — which is exactly why §15.2 wants this confirmed.
 */
export function removeCard(run: RunState, card: CardId): MarketResult {
  if (card === SIGNATURE_CARD) return { ok: false, refusal: { reason: 'signature' } };
  if (!run.deck.includes(card)) return { ok: false, refusal: { reason: 'not-in-deck' } };
  if (run.deck.length - 1 < DECK_FLOOR) return { ok: false, refusal: { reason: 'deck-floor' } };

  const price = removalPrice(run.removals);
  if (price === null) return { ok: false, refusal: { reason: 'ladder-spent' } };
  if (run.gold < price) return { ok: false, refusal: { reason: 'too-poor', price } };

  const index = run.deck.indexOf(card);

  return {
    ok: true,
    run: {
      ...run,
      gold: run.gold - price,
      removals: run.removals + 1,
      // One copy, not every copy: §5.1's deck holds repeats, and a player
      // thinning a deck of three Jabs means one of them.
      deck: [...run.deck.slice(0, index), ...run.deck.slice(index + 1)],
      build: strippedOf(run, card),
    },
  };
}

/**
 * The card's sockets and their gems leave with it — but only when the last copy
 * goes. A deck holding three Jabs shares one socket record between them, so
 * stripping it while two remain would silently un-socket a card still in play.
 */
function strippedOf(run: RunState, card: CardId): RunState['build'] {
  const copiesLeft = run.deck.filter((held) => held === card).length - 1;
  if (copiesLeft > 0) return run.build;

  const doomed = new Set<string>(socketsOf(run.build.sockets, card).gems);
  const { [card]: gone, ...survivingSockets } = run.build.sockets;
  void gone;

  return {
    ...run.build,
    sockets: survivingSockets,
    gems: Object.fromEntries(Object.entries(run.build.gems).filter(([id]) => !doomed.has(id))),
  };
}

/** What removal would cost next, or null once §9's four rungs are spent. */
export function nextRemovalPrice(run: RunState): number | null {
  return removalPrice(run.removals);
}
