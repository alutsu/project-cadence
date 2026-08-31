import { NO_MODIFIER, registerEffect, type CardModifier, type EffectInput } from './gemEffects.ts';

/**
 * The effect atoms GDD §6.2's frames are built from (docs/M1_PLAN.md D33).
 *
 * S3 registers the **modify** phase only — the levers that change what a card
 * is before it is swung. The frames those cover are REPEAT, BREAK, HASTE and
 * KINDLE. CHARGE, SPEND, SIPHON, ECHO, WARD and LINGER all accumulate across a
 * fight and arrive with the react phase in S4.
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
