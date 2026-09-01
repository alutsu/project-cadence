import { isAlive, settleDeath, type Actor, type Intent } from './actor.ts';
import type { CardDefinition } from './card.ts';
import type { CombatEvent } from './events.ts';
import { absorb } from './guard.ts';
import type { ActorId } from './ids.ts';
import { breaksPoise, stagger } from './poise.ts';
import type { ResolvedCard } from './resolve.ts';
import { resolveCard } from './resolve.ts';
import {
  findActor,
  livingEnemies,
  playerActor,
  withActor,
  type CombatState,
  type CombatStep,
} from './state.ts';
import { damageScale } from './status.ts';
import type { Tag } from './tag.ts';
import { weaveVerdict, type TagVerdict, type WeaveSnapshot } from './weave.ts';
import { NO_LEVERS, type RelicLevers } from './relicEffects.ts';

/**
 * The one damage path (docs/M1_PLAN.md D27).
 *
 * M0 had two. An immediate strike computed its damage at the moment it landed
 * and applied Empower and Weaken on the way; a wind-up Ultimate snapshotted a
 * bare number at commit and skipped them entirely. The Weave would have doubled
 * that divergence — a multiplier could honestly have been read at either end —
 * so both now resolve through here.
 */

/** A blow, fully priced, against one defender. */
export interface ResolvedHit {
  /** What lands, after the Weave and after Empower or Weaken. Rounded once. */
  readonly amount: number;
  /**
   * What the §4.6 Poise threshold is compared against. Equal to `amount` unless
   * a BREAK gem is seated, which is exactly what §6.2 [AMD] means by "+% damage
   * *counted for the Poise check*" — the blow does not hit harder, it shakes
   * harder.
   */
  readonly poiseAmount: number;
  /** BREAK's other half: added to the first Stagger before the ladder halves. */
  readonly staggerBonus: number;
  /**
   * The tag the blow carries, or null for an enemy intent. Enemies strike with
   * no tag: §7 prices *your* tags against *their* resistance, and the player
   * has no resistance table to price anything against.
   */
  readonly tag: Tag | null;
  /** Why `amount` is what it is — the panel and the hover read it (P3). */
  readonly verdict: TagVerdict | null;
}

export interface HitOrder {
  readonly resolved: ResolvedCard;
  readonly attacker: Actor;
  readonly defender: Actor;
}

/**
 * GDD §7 applied to one blow. Exactly two roundings exist in the whole
 * pipeline and this is the second: `damagePerTarget` rounds the AoE share,
 * because that is the figure the card face prints, and everything else lands
 * here. A third would let the hover and the commit disagree by a point.
 */
export function resolveHit(
  order: HitOrder,
  weave: WeaveSnapshot,
  levers: RelicLevers = NO_LEVERS,
): ResolvedHit {
  const { resolved, attacker, defender } = order;
  const verdict = weaveVerdict({
    tag: resolved.tag,
    weave,
    resistances: defender.resistances,
  });
  // GDD §10 Glass Sigil: *"+30% damage dealt and taken"*. Applied here, which is
  // the one place both the card face and the real strike read — the UI shows
  // post-relic damage without computing it (P3, CLAUDE.md §2.1).
  const scaled =
    resolved.basePerTarget *
    verdict.multiplier *
    damageScale(attacker.statuses) *
    levers.damageDealtMult;
  const amount = Math.round(scaled);

  return {
    amount,
    poiseAmount: Math.round(scaled * resolved.poiseFactor),
    staggerBonus: resolved.staggerBonus,
    tag: resolved.tag,
    verdict,
  };
}

/** An enemy's telegraphed blow. No card, no tag, no Weave — just Empower. */
export function resolveIntent(
  attacker: Actor,
  intent: Intent,
  levers: RelicLevers = NO_LEVERS,
): ResolvedHit {
  // The other half of Glass Sigil. An enemy's blow carries no tag and no Weave
  // (§4.5), so `damageTakenMult` is the only relic term it has.
  const amount = Math.round(
    intent.damage * damageScale(attacker.statuses) * levers.damageTakenMult,
  );
  // The player has no Poise (GDD §4.6), so an intent has nothing to shake.
  return { amount, poiseAmount: amount, staggerBonus: 0, tag: null, verdict: null };
}

export interface DamageOrder {
  readonly source: ActorId;
  readonly target: ActorId;
  readonly hit: ResolvedHit;
}

/**
 * Guard absorbs before HP (GDD §4.4), then the Poise threshold is checked.
 *
 * Deliberately does not settle the encounter's outcome: the actor that struck
 * still has to be rescheduled, and the log must read in causal order.
 */
export function applyDamage(state: CombatState, order: DamageOrder): CombatStep {
  const target = findActor(state, order.target);
  if (target === undefined || !isAlive(target)) return { state, events: [] };

  const { amount, poiseAmount, staggerBonus, tag } = order.hit;
  const { actor: wounded, absorbed } = absorb(target, amount);

  const events: CombatEvent[] = [
    {
      kind: 'damage_dealt',
      at: state.now,
      source: order.source,
      target: order.target,
      amount,
      tag,
    },
  ];
  if (absorbed > 0) {
    events.push({ kind: 'guard_absorbed', at: state.now, actor: order.target, amount: absorbed });
  }

  // GDD §4.6: a single hit at or above the Poise threshold staggers. The check
  // uses the damage the attack carried, before Guard soaked any of it — and
  // after the Weave, because a resisted blow is a smaller blow, and §4.6 asks
  // what actually landed rather than what was printed on the card. A BREAK gem
  // moves this figure without moving the damage (§6.2 [AMD]).
  const shaken =
    isAlive(wounded) && breaksPoise(wounded, poiseAmount)
      ? stagger(wounded, state.rules.firstStagger + staggerBonus)
      : null;
  if (shaken !== null) {
    events.push({ kind: 'staggered', at: state.now, actor: order.target, delay: shaken.delay });
  }
  if (!isAlive(wounded)) events.push({ kind: 'actor_died', at: state.now, actor: order.target });

  return { state: withActor(state, settleDeath(shaken?.actor ?? wounded)), events };
}

/**
 * What one enemy would take from this card if the player swung it now.
 *
 * GDD §15: *hovering a card shows post-Weave damage against the current target,
 * not base damage — the player should never do multiplication in their head*.
 * The card face cannot work that out for itself (CLAUDE.md §2.1), and once §7
 * moves a tag the printed figure stops being the answer: Crush prints 24 and
 * lands 17 against a rat that shrugs off 30% of Shadow.
 *
 * Falls back to the front of the line when nothing is targeted, because that is
 * what a click would hit, and to the unpriced figure when there is no line left
 * to price against.
 */
export function damageAgainst(
  state: CombatState,
  card: CardDefinition,
  target: ActorId | null,
): number {
  const resolved = resolveCard({ weave: state.weave, card, levers: state.levers });
  const attacker = playerActor(state);
  const defender = target === null ? livingEnemies(state)[0] : findActor(state, target);

  if (attacker === undefined || defender === undefined) return resolved.basePerTarget;
  return resolveHit({ resolved, attacker, defender }, state.weave, state.levers).amount;
}
