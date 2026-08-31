import type { CardDefinition } from './card.ts';
import type { GemEffect } from './gem.ts';
import type { Tag } from './tag.ts';

/**
 * The effect-atom registry (CLAUDE.md §4.2, docs/M1_PLAN.md D33).
 *
 * GDD §6.2 names ten frames. This module deliberately does not know any of
 * them. A **frame is a recipe** — authored in `src/data/frames.json`, naming
 * which atoms it rolls and in what range — and an **atom is a registered
 * handler**. Roughly sixteen atoms cover all ten frames, and an eleventh frame
 * built from atoms that already exist costs no code at all, which is a stronger
 * Open/Closed result than a handler per frame (where a new frame always costs a
 * file).
 *
 * The split is honest about its own boundary: the *frames* are the open part,
 * the **levers below are the closed part**. A frame that needs a lever nobody
 * has is a real design change and should be a real edit, not something smuggled
 * in through data.
 */

/**
 * Everything a gem is allowed to do to a card, and nothing else.
 *
 * Each field states how it folds, because folding is where two gems in the same
 * card either compose or fight: multipliers take the product, deltas sum, and a
 * conversion is last-wins in socket order.
 */
export interface CardModifier {
  /** Product. GDD §6.2: every frame's drawback is usually one of these. */
  readonly damageMult: number;
  /** Sum. REPEAT's extra blow; the damage split is a separate damageMult. */
  readonly extraStrikes: number;
  /** Sum, signed ticks — never Tick, which rejects a negative (plan D17). */
  readonly weightDelta: number;
  readonly recoveryDelta: number;
  /** Product. BREAK: "+% damage counted for the Poise check" (GDD §6.2 [AMD]). */
  readonly poiseFactor: number;
  /** Sum. BREAK's other half: the first Stagger is worth more (GDD §4.6). */
  readonly staggerBonus: number;
  /**
   * Last non-null wins, in socket order. KINDLE converts the damage to a tag
   * and thereby "exposes you to that tag's Weave value" (GDD §6.2) — so the
   * conversion has to happen before the Weave is consulted, not after.
   */
  readonly convertTag: Tag | null;
}

/** A card with nothing seated in it. The identity of `foldModifiers`. */
export const NO_MODIFIER: CardModifier = {
  damageMult: 1,
  extraStrikes: 0,
  weightDelta: 0,
  recoveryDelta: 0,
  poiseFactor: 1,
  staggerBonus: 0,
  convertTag: null,
};

export function foldModifiers(left: CardModifier, right: CardModifier): CardModifier {
  return {
    damageMult: left.damageMult * right.damageMult,
    extraStrikes: left.extraStrikes + right.extraStrikes,
    weightDelta: left.weightDelta + right.weightDelta,
    recoveryDelta: left.recoveryDelta + right.recoveryDelta,
    poiseFactor: left.poiseFactor * right.poiseFactor,
    staggerBonus: left.staggerBonus + right.staggerBonus,
    convertTag: right.convertTag ?? left.convertTag,
  };
}

/**
 * What a handler is given, and it is the whole list on purpose.
 *
 * No `Rng`, no `CombatState`, no clock. A handler therefore *cannot* be
 * nondeterministic and cannot read another gem's state — the purity that
 * GDD §20.2 needs is a property of this type rather than a rule reviewers have
 * to keep enforcing. `value` is the number this gem rolled at craft time, in
 * the run layer, and is a constant by the time combat sees it.
 */
export interface EffectInput {
  readonly value: number;
  /** Set only by the atoms that name a tag; null everywhere else. */
  readonly tag: Tag | null;
  readonly card: CardDefinition;
}

/**
 * A discriminated union with one member today (CLAUDE.md §3.2).
 *
 * S4 adds `'react'`, for the frames that accumulate across a fight — CHARGE
 * gaining charges on a kill, ECHO firing once. The discriminant is here now so
 * that adding it is additive rather than a rewrite of every handler, and so the
 * two phases can never be confused for optional methods on one shape (§4.3).
 */
export type EffectHandler = {
  readonly type: string;
  readonly phase: 'modify';
  readonly modify: (input: EffectInput) => CardModifier;
};

const HANDLERS = new Map<string, EffectHandler>();

/**
 * Registering the same atom twice is a programmer error, not an override: two
 * modules quietly disagreeing about what `DAMAGE_MULT` means is the exact bug
 * a registry is supposed to make impossible.
 */
export function registerEffect(handler: EffectHandler): void {
  const existing = HANDLERS.get(handler.type);
  if (existing !== undefined && existing !== handler) {
    throw new Error(`effect "${handler.type}" is already registered`);
  }
  HANDLERS.set(handler.type, handler);
}

export function isRegisteredEffect(type: string): boolean {
  return HANDLERS.has(type);
}

/** Fails loudly and by name (CLAUDE.md §5.4). */
export function effectHandler(type: string): EffectHandler {
  const handler = HANDLERS.get(type);
  if (handler === undefined) throw new Error(`unregistered gem effect: "${type}"`);
  return handler;
}

/** Every atom a gem's effects and affixes add up to, in the order listed. */
export function modifierOf(effects: readonly GemEffect[], card: CardDefinition): CardModifier {
  return effects.reduce(
    (total, effect) =>
      foldModifiers(
        total,
        effectHandler(effect.type).modify({ value: effect.value, tag: effect.tag, card }),
      ),
    NO_MODIFIER,
  );
}
