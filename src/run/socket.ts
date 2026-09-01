import { NO_SOCKETS, type CardSockets } from '../sim/gem.ts';
import type { CardId, GemId } from '../sim/ids.ts';
import type { Rng } from '../sim/rng.ts';

/**
 * Sockets (GDD §6.1).
 *
 * | Socket # | Cost | Success |
 * |---|---|---|
 * | 1st | 8% Max HP | 100% |
 * | 2nd | 12% Max HP | 75% |
 * | 3rd | 18% Max HP + 1 Insight | 45% |
 *
 * The cost is a share of **maximum** HP, not current, so healing cannot refund
 * it — §6.1 closes the "healer socketed everything" exploit at the root rather
 * than taxing it with more RNG. It is also the only permanent downward pressure
 * in the game, which is what makes a socket a decision rather than a purchase.
 */

/** GDD §6.1's table. Index 0 is the first socket. */
export const SOCKET_COSTS: readonly number[] = [0.08, 0.12, 0.18];
export const SOCKET_ODDS: readonly number[] = [1, 0.75, 0.45];
/** GDD §6.1: the third socket also costs Insight (§8 — creativity is paid). */
export const SOCKET_INSIGHT: readonly number[] = [0, 0, 1];
export const MAX_SOCKETS = SOCKET_COSTS.length;

/**
 * However much §10's relics discount a socket, it costs at least this share.
 *
 * The GDD does not state a floor — Bone Ledger is the only relic that discounts
 * and 4% off 8% still leaves something — but the rule belongs here rather than
 * in the one relic that happens not to breach it, because P1 makes the Max HP
 * cost the whole reason a socket is a decision (§6.1).
 */
export const MIN_SOCKET_SHARE = 0.02;

/** GDD §6.1: a scarred card costs half again, and never more than that. */
export const SCAR_SURCHARGE = 0.5;

export interface SocketPrice {
  /** Max HP the attempt spends, win or lose. Rounded up — never free. */
  readonly maxHp: number;
  readonly insight: number;
  readonly chance: number;
  readonly scarred: boolean;
}

export interface SocketQuery {
  readonly sockets: CardSockets;
  readonly maxHp: number;
  /** GDD §6.1's floor: 40% of the level baseline, as an absolute number. */
  readonly floor: number;
  readonly insight: number;
  /**
   * GDD §10 Bone Ledger: percentage points off the Max HP share. Optional
   * because most callers hold no relics, and defaulting it beats making every
   * one of them pass a zero.
   */
  readonly costDelta?: number;
}

/** What the next socket on this card would cost, right now (GDD §6.1). */
export function socketPrice(query: SocketQuery): SocketPrice | null {
  const next = query.sockets.opened;
  const share = SOCKET_COSTS[next];
  const chance = SOCKET_ODDS[next];
  const insight = SOCKET_INSIGHT[next];
  if (share === undefined || chance === undefined || insight === undefined) return null;

  const surcharge = query.sockets.scarred ? 1 + SCAR_SURCHARGE : 1;
  // A relic may discount the share but never to nothing: §6.1's cost is the one
  // thing paying for the build, and a free socket stops it being a decision.
  const discounted = Math.max(MIN_SOCKET_SHARE, share + (query.costDelta ?? 0));

  return {
    // Rounded up: a cheap socket on a small pool must still cost something, or
    // the percentage quietly becomes free at the bottom of the range.
    maxHp: Math.ceil(query.maxHp * discounted * surcharge),
    insight,
    chance,
    scarred: query.sockets.scarred,
  };
}

export type SocketRefusal =
  | { readonly reason: 'no_socket_left' }
  | { readonly reason: 'would_breach_floor'; readonly floor: number }
  | { readonly reason: 'not_enough_insight'; readonly needed: number };

/**
 * Whether the attempt may be made at all — checked before any of it is spent.
 *
 * The floor is the important one (GDD §6.1 [NEW]): it stops a death-spiral
 * build that cannot survive a boss hit, and stops an unwinnable-state softlock.
 * A refusal names its reason so the forge can say why rather than greying a
 * button out (CLAUDE.md §5.4).
 */
export function socketRefusal(query: SocketQuery): SocketRefusal | null {
  const price = socketPrice(query);
  if (price === null) return { reason: 'no_socket_left' };
  if (query.maxHp - price.maxHp < query.floor) {
    return { reason: 'would_breach_floor', floor: query.floor };
  }
  if (query.insight < price.insight) {
    return { reason: 'not_enough_insight', needed: price.insight };
  }
  return null;
}

export interface SocketAttempt {
  readonly opened: boolean;
  readonly sockets: CardSockets;
  readonly maxHp: number;
  readonly insight: number;
  readonly price: SocketPrice;
}

/**
 * One attempt (GDD §6.1). On failure the HP is still spent, no socket opens,
 * and the card is **Scarred** — which is the whole shape of the gamble.
 *
 * Draws exactly once whatever the odds, including at 100%, so the stream
 * position does not depend on the result (GDD §20.2, docs/M1_PLAN.md D32).
 */
export function attemptSocket(query: SocketQuery, rng: Rng): SocketAttempt | SocketRefusal {
  const refusal = socketRefusal(query);
  if (refusal !== null) return refusal;

  const price = socketPrice(query);
  if (price === null) return { reason: 'no_socket_left' };

  const roll = rng.nextFloat();
  const opened = roll < price.chance;

  return {
    opened,
    sockets: {
      opened: opened ? query.sockets.opened + 1 : query.sockets.opened,
      gems: query.sockets.gems,
      // Scarred does not stack past +50% (GDD §6.1) — it is a flag, not a tally.
      scarred: opened ? query.sockets.scarred : true,
    },
    maxHp: query.maxHp - price.maxHp,
    insight: query.insight - price.insight,
    price,
  };
}

/** GDD §6.2: socketing is permanent, so seating one is the last free step. */
export function seatGem(sockets: CardSockets, gem: GemId): CardSockets {
  if (sockets.gems.length >= sockets.opened) return sockets;
  return { ...sockets, gems: [...sockets.gems, gem] };
}

/**
 * GDD §6.2: "Removal is free but destroys the gem." The socket stays open; the
 * gem does not come back, which is what stops a loadout being swapped per fight.
 */
export function removeGem(sockets: CardSockets, gem: GemId): CardSockets {
  return { ...sockets, gems: sockets.gems.filter((seated) => seated !== gem) };
}

export function socketsOf(table: Readonly<Record<string, CardSockets>>, card: CardId): CardSockets {
  return table[card] ?? NO_SOCKETS;
}
