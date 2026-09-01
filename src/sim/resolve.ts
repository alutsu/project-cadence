import type { CardDefinition, CardTargeting } from './card.ts';
import { EMPTY_BUILD, gemsIn, runtimeOf, type BuildState, type Gem } from './gem.ts';
import { foldModifiers, modifierOf, NO_MODIFIER, type CardModifier } from './gemEffects.ts';
// Imported for its registrations, not for a binding. The registry is only
// Open/Closed if it is *populated* — a consumer that forgets this import gets a
// loud throw rather than silent gems, but relying on every caller to remember
// is a footgun, and there is exactly one standard set (docs/M1_PLAN.md D33).
// Adding an atom still costs one line in that module and no edit here.
import './standardEffects.ts';
import type { CardId } from './ids.ts';
import type { StatusApplication } from './status.ts';
import type { Tag } from './tag.ts';
import { damagePerTarget } from './targeting.ts';
import { tick, type Tick } from './tick.ts';
import { NO_LEVERS, type RelicLevers } from './relicEffects.ts';
import { ATTUNEMENT_TABLE, type WeaveSnapshot } from './weave.ts';

/**
 * What a card actually does, before anyone has been picked to receive it.
 *
 * The split between this and `strike.ts` is forced by the Weave: a card's
 * damage depends on which enemy it lands on (§7.2 resistance is per-actor), but
 * its Weight, Recovery and reach do not. Everything that can be known without a
 * defender is known here, once per play.
 *
 * This is the only place a card's printed numbers are turned into the numbers
 * the game runs on. `WEIGHT_CLASSES` is never rewritten (GDD §4.1) — riders sit
 * on top of it and are resolved fresh every time.
 */
export interface ResolvedCard {
  readonly card: CardId;
  readonly name: string;
  readonly tag: Tag;
  readonly targeting: CardTargeting;
  /**
   * What one enemy takes before the Weave and before Empower or Weaken.
   *
   * Deliberately *not* rounded: the AoE share was already rounded, because that
   * is the figure the card face prints (GDD §4.8), and the final blow rounds
   * once in `resolveHit`. A gem multiplier folded in between those two must not
   * add a third rounding, or the hover and the commit drift by a point.
   */
  readonly basePerTarget: number;
  readonly weight: Tick;
  readonly recovery: Tick;
  /** 1, plus REPEAT's extra blows (GDD §6.2). */
  readonly strikes: number;
  /** BREAK: what the §4.6 Poise check multiplies the landed damage by. */
  readonly poiseFactor: number;
  /** BREAK: added to the first Stagger before the ladder halves it (§4.6). */
  readonly staggerBonus: number;
  /** WARD: Guard the card puts up when it is played (GDD §6.2, §4.4). */
  readonly guardGain: number;
  /** SIPHON: the share of damage dealt that comes back as health. */
  readonly lifestealShare: number;
  /** ECHO: back to hand rather than onto the Recovery clock (GDD §4.9). */
  readonly returnsToHand: boolean;
  /** What the card inflicts, already stretched and weakened by LINGER. */
  readonly applies: StatusApplication | null;
}

/**
 * GDD §4.1's delay is `ceil(weight × 100 / speed)`, so a Weight of 0 is a delay
 * of 0 — an actor that acts again on the tick it just acted, forever. Ascendant
 * alone reaches 3 on a Light card; Ascendant plus a HASTE gem reaches 0
 * (docs/M1_PLAN.md D17). The floor is what keeps the scheduler total.
 */
export const MIN_WEIGHT = 1;
const MIN_RECOVERY = 0;
/** A card always swings at least once, however badly its gems roll. */
const MIN_STRIKES = 1;

/**
 * GDD §7.1: an Ascendant tag is −1 Weight and a Suppressed one is +1.
 *
 * Signed arithmetic all the way, branded exactly once at the end — `tick()`
 * rejects a negative, so summing riders as `Tick` would throw halfway through a
 * sum that ends up positive (docs/M1_PLAN.md D17).
 */
function riddenWeight(base: Tick, weave: WeaveSnapshot, tag: Tag): Tick {
  // Read from the snapshot's own table, not the module constant: §10's Weave
  // relics rewrite it, and a rider from one table with a multiplier from another
  // would be two different Weaves in one strike.
  const rider = (weave.profiles ?? ATTUNEMENT_TABLE)[weave.attunement[tag]].weightDelta;
  return tick(Math.max(MIN_WEIGHT, base + rider));
}

/**
 * GDD §10 Metronome: *"your first action each encounter costs 0 Weight"*.
 *
 * Zero, not one — the floor `MIN_WEIGHT` exists to stop an actor acting again on
 * the tick it acted, and a *single* free action cannot loop, because the next
 * one is no longer the first. So the floor is deliberately bypassed here, and
 * only here.
 */
function relicWeight(base: Tick, levers: RelicLevers, committed: number): Tick {
  if (levers.freeFirstWeight && committed === 0) return tick(0);
  if (levers.weightDelta === 0) return base;
  return tick(Math.max(MIN_WEIGHT, base + levers.weightDelta));
}

/** Every gem seated in the card, folded in socket order (docs/M1_PLAN.md D33). */
function seatedModifier(
  card: CardDefinition,
  gems: readonly Gem[],
  build: BuildState,
): CardModifier {
  return gems.reduce((total, gem) => {
    const runtime = runtimeOf(build, gem.id);
    return foldModifiers(
      foldModifiers(total, { ...NO_MODIFIER, weightDelta: gem.weightDelta }),
      foldModifiers(modifierOf(gem.effects, card, runtime), modifierOf(gem.affixes, card, runtime)),
    );
  }, NO_MODIFIER);
}

/**
 * LINGER (GDD §6.2): longer, but weaker. The duration stretches and the
 * magnitude shrinks, and a status can never be stretched into nothing — a
 * magnitude rounded to zero would be a status that expires having done nothing,
 * which reads as a bug rather than as a trade.
 */
function lingered(
  application: StatusApplication | null,
  modifier: CardModifier,
): StatusApplication | null {
  if (application === null) return null;

  return {
    kind: application.kind,
    magnitude: Math.max(1, Math.round(application.magnitude * modifier.statusMagnitudeMult)),
    duration:
      application.duration === null
        ? null
        : tick(Math.max(1, Math.round(application.duration * modifier.statusDurationMult))),
  };
}

/** Everything about a play that does not depend on who receives it. */
/**
 * Everything one resolution needs. An options object because §10's relics made
 * it a fourth argument, and four positional arguments is where a call site stops
 * saying what it means (CLAUDE.md §5.2).
 */
export interface ResolveQuery {
  readonly weave: WeaveSnapshot;
  readonly card: CardDefinition;
  readonly build?: BuildState;
  /** GDD §10's folded levers. Omitted means no relics held. */
  readonly levers?: RelicLevers;
  /**
   * Actions the actor has already committed this encounter — §10's Metronome
   * makes the first one free, and "first" is only knowable from here.
   */
  readonly committed?: number;
}

export function resolveCard(query: ResolveQuery): ResolvedCard {
  const { weave, card } = query;
  const build = query.build ?? EMPTY_BUILD;
  const levers = query.levers ?? NO_LEVERS;
  const modifier = seatedModifier(card, gemsIn(build, card.id), build);

  // KINDLE converts before the Weave is consulted, because §6.2's drawback is
  // that the conversion "exposes you to that tag's Weave value" — the new tag
  // is what gets priced, and what carries §7.1's ±1 Weight rider.
  const tag = modifier.convertTag ?? card.tag;

  return {
    card: card.id,
    name: card.name,
    tag,
    targeting: card.targeting,
    basePerTarget: damagePerTarget(card) * modifier.damageMult,
    weight: relicWeight(
      riddenWeight(tick(Math.max(0, card.weight + modifier.weightDelta)), weave, tag),
      levers,
      query.committed ?? 0,
    ),
    recovery: tick(Math.max(MIN_RECOVERY, card.recovery + modifier.recoveryDelta)),
    strikes: Math.max(MIN_STRIKES, 1 + modifier.extraStrikes),
    poiseFactor: modifier.poiseFactor,
    staggerBonus: modifier.staggerBonus,
    guardGain: modifier.guardGain,
    lifestealShare: modifier.lifestealShare,
    returnsToHand: modifier.returnsToHand,
    applies: lingered(card.applies, modifier),
  };
}
