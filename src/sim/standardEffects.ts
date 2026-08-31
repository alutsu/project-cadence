import {
  NO_MODIFIER,
  registerEffect,
  type CardModifier,
  type EffectInput,
  type EffectOutcome,
  type ReactionInput,
} from './gemEffects.ts';

/**
 * The effect atoms GDD §6.2's frames are built from (docs/M1_PLAN.md D33).
 *
 * Two phases. **Modify** atoms change what a card *is* before it is swung;
 * **react** atoms answer to what happened and carry a gem's counters forward.
 * Between them they cover all ten of §6.2's frames.
 *
 * Registration is a side effect of importing this module, and the data parsers
 * import it — so validating a gem catalogue is what guarantees the atoms it
 * names exist. Anything that slips through still fails loudly by name rather
 * than silently doing nothing (`effectHandler`, CLAUDE.md §5.4).
 */

function only(fields: Partial<CardModifier>): CardModifier {
  return { ...NO_MODIFIER, ...fields };
}

/** A share of damage, signed: −0.35 is REPEAT's split, +0.2 an affix's gift. */
registerEffect({
  type: 'DAMAGE_MULT',
  phase: 'modify',
  modify: ({ value }: EffectInput): CardModifier => only({ damageMult: 1 + value }),
});

/** REPEAT (GDD §6.2): the card strikes again. Its cost is the split above. */
registerEffect({
  type: 'EXTRA_STRIKE',
  phase: 'modify',
  modify: ({ value }: EffectInput): CardModifier => only({ extraStrikes: Math.trunc(value) }),
});

/** HASTE's −Weight, and REPEAT's +Weight drawback when rolled as an affix. */
registerEffect({
  type: 'WEIGHT_DELTA',
  phase: 'modify',
  modify: ({ value }: EffectInput): CardModifier => only({ weightDelta: Math.trunc(value) }),
});

/** HASTE's other half, and the affix §6.2's own example rolls. */
registerEffect({
  type: 'RECOVERY_DELTA',
  phase: 'modify',
  modify: ({ value }: EffectInput): CardModifier => only({ recoveryDelta: Math.trunc(value) }),
});

/**
 * BREAK (GDD §6.2 [AMD]): "+% damage counted for the Poise check".
 *
 * It moves what the §4.6 threshold is compared against, not the damage dealt —
 * which is what makes BREAK a Stagger tool rather than a damage gem, and why
 * Poise stays a threshold rather than becoming a pool.
 */
registerEffect({
  type: 'POISE_FACTOR',
  phase: 'modify',
  modify: ({ value }: EffectInput): CardModifier => only({ poiseFactor: 1 + value }),
});

/** BREAK's "+Stagger": the first Stagger lands heavier, then the ladder halves. */
registerEffect({
  type: 'STAGGER_BONUS',
  phase: 'modify',
  modify: ({ value }: EffectInput): CardModifier => only({ staggerBonus: Math.trunc(value) }),
});

/**
 * KINDLE (GDD §6.2): the card's damage becomes another tag, which "exposes you
 * to that tag's Weave value" — the drawback *is* the exposure. The conversion
 * therefore has to land before the Weave is consulted, which is why it is a
 * modify-phase lever rather than something applied to the finished number.
 */
registerEffect({
  type: 'CONVERT_TAG',
  phase: 'modify',
  modify: ({ tag }: EffectInput): CardModifier => {
    if (tag === null) throw new RangeError('CONVERT_TAG names no tag');
    return only({ convertTag: tag });
  },
});

/** WARD (GDD §6.2): the card also puts Guard up (§4.4). Its cost is +Weight. */
registerEffect({
  type: 'GUARD_GAIN',
  phase: 'modify',
  modify: ({ value }: EffectInput): CardModifier => only({ guardGain: Math.trunc(value) }),
});

/** SIPHON (GDD §6.2): a share of the damage dealt comes back as health. */
registerEffect({
  type: 'LIFESTEAL',
  phase: 'modify',
  modify: ({ value }: EffectInput): CardModifier => only({ lifestealShare: value }),
});

/** LINGER (GDD §6.2): what the card inflicts lasts longer... */
registerEffect({
  type: 'STATUS_DURATION',
  phase: 'modify',
  modify: ({ value }: EffectInput): CardModifier => only({ statusDurationMult: 1 + value }),
});

/** ...and hits for less while it does. That trade is the whole frame. */
registerEffect({
  type: 'STATUS_MAGNITUDE',
  phase: 'modify',
  modify: ({ value }: EffectInput): CardModifier => only({ statusMagnitudeMult: 1 + value }),
});

/**
 * ECHO (GDD §6.2): the card comes back to hand instead of cooling, once a
 * fight. The once-ness is the gate, so the atom reads the counter its sibling
 * `MARK_USED` writes — composition in the data rather than a branch in a
 * handler (docs/M1_PLAN.md D33).
 */
registerEffect({
  type: 'RETURN_TO_HAND',
  phase: 'modify',
  modify: ({ runtime }: EffectInput): CardModifier => only({ returnsToHand: runtime.uses === 0 }),
});

/** ECHO's other half: having come back once, it does not come back again. */
registerEffect({
  type: 'MARK_USED',
  phase: 'react',
  on: ['played'],
  react: ({ runtime }: ReactionInput): EffectOutcome => ({
    runtime: { ...runtime, uses: runtime.uses + 1 },
    heal: 0,
    guard: 0,
  }),
});

/** SPEND (GDD §6.2): the charges become damage. Dead without a Charge source. */
registerEffect({
  type: 'SPEND_CHARGES',
  phase: 'modify',
  modify: ({ value, runtime }: EffectInput): CardModifier =>
    only({ damageMult: 1 + value * runtime.charges }),
});

/** SPEND's other half: they are spent, so they are gone. */
registerEffect({
  type: 'CONSUME_CHARGES',
  phase: 'react',
  on: ['played'],
  react: ({ runtime }: ReactionInput): EffectOutcome => ({
    runtime: { ...runtime, charges: 0 },
    heal: 0,
    guard: 0,
  }),
});

/** CHARGE (GDD §6.2): a kill stores something. Dead socket until it does. */
registerEffect({
  type: 'CHARGE_ON_KILL',
  phase: 'react',
  on: ['killed'],
  react: ({ value, runtime }: ReactionInput): EffectOutcome => ({
    runtime: { ...runtime, charges: runtime.charges + Math.trunc(value) },
    heal: 0,
    guard: 0,
  }),
});

/** SIPHON's payout, measured against what actually landed rather than printed. */
registerEffect({
  type: 'SIPHON_HIT',
  phase: 'react',
  on: ['hit'],
  react: ({ value, runtime, trigger }: ReactionInput): EffectOutcome => ({
    runtime,
    heal: trigger.kind === 'hit' ? Math.round(trigger.amount * value) : 0,
    guard: 0,
  }),
});
