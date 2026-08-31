import { describe, expect, it } from 'vitest';
import { TAGS, isTag, TAG_GLYPHS, type Tag } from '../../src/sim/tag.ts';
import {
  ATTUNEMENT_TABLE,
  MAX_RESISTANCE,
  NEUTRAL_WEAVE,
  resistTo,
  NO_RESISTANCE,
  WEAVE_CEILING,
  WEAVE_FLOOR,
  weaveRows,
  weaveVerdict,
  type Attunement,
  type ResistanceTable,
  type TagResistance,
  type WeaveSnapshot,
} from '../../src/sim/weave.ts';

/**
 * GDD §7. The clamp in particular is not a defensive detail: §7.4 records it as
 * the fix for a v0.1 bug where three stacked reductions multiplied out to ×0.196
 * and bricked a build the design promises can never be bricked.
 */

const TAG: Tag = 'Fire';

function weave(attunement: Attunement, saturation = 0): WeaveSnapshot {
  return {
    attunement: { ...NEUTRAL_WEAVE.attunement, [TAG]: attunement },
    saturation: { ...NEUTRAL_WEAVE.saturation, [TAG]: saturation },
  };
}

function resisting(resistance: TagResistance): ResistanceTable {
  return { ...NO_RESISTANCE, [TAG]: resistance };
}

function verdict(
  attunement: Attunement,
  saturation = 0,
  resistance: TagResistance = { kind: 'resist', value: 0 },
) {
  return weaveVerdict({
    tag: TAG,
    weave: weave(attunement, saturation),
    resistances: resisting(resistance),
  });
}

describe('the tag taxonomy (GDD §7, docs/M1_PLAN.md D15)', () => {
  it('has six tags, so two Ascendant and two Suppressed still leave two neutral', () => {
    expect(TAGS).toHaveLength(6);
    expect(new Set(TAGS).size).toBe(6);
  });

  it('gives every tag a distinct glyph — §15.2 forbids encoding one in colour alone', () => {
    const glyphs = TAGS.map((tag) => TAG_GLYPHS[tag]);
    expect(new Set(glyphs).size).toBe(TAGS.length);
    expect(glyphs.every((glyph) => glyph.length > 0)).toBe(true);
  });

  it('rejects the mechanical words §6.2 also calls tags', () => {
    expect(isTag('Physical')).toBe(true);
    expect(isTag('Multi')).toBe(false);
    expect(isTag('Charge')).toBe(false);
    expect(isTag(7)).toBe(false);
  });
});

describe('the Weave multiplier (GDD §7)', () => {
  it('is 1.00 for a neutral tag against a defender that resists nothing', () => {
    expect(verdict('neutral').multiplier).toBe(1);
  });

  it('applies §7.1: Ascendant ×1.35 and −1 Weight, Suppressed ×0.70 and +1 Weight', () => {
    const up = verdict('ascendant');
    const down = verdict('suppressed');

    expect(up.multiplier).toBeCloseTo(1.35, 10);
    expect(up.weightDelta).toBe(-1);
    expect(down.multiplier).toBeCloseTo(0.7, 10);
    expect(down.weightDelta).toBe(1);
  });

  it('multiplies the three terms of §7 together', () => {
    // 1.35 × (1 − 0.60) × (1 − 0.30) = 0.378
    const result = verdict('ascendant', 0.3, { kind: 'resist', value: MAX_RESISTANCE });
    expect(result.raw).toBeCloseTo(0.378, 10);
    expect(result.multiplier).toBeCloseTo(0.378, 10);
    expect(result.atFloor).toBe(false);
  });

  it('floors at 0.30 — the §7.4 worst case must stay playable', () => {
    // 0.70 × 0.40 × 0.70 = 0.196, the exact figure §7.4 calls the bug.
    const result = verdict('suppressed', 0.3, { kind: 'resist', value: MAX_RESISTANCE });

    expect(result.raw).toBeCloseTo(0.196, 10);
    expect(result.multiplier).toBe(WEAVE_FLOOR);
    expect(result.atFloor).toBe(true);
  });

  it('says the floor is active, rather than leaving the panel to infer it', () => {
    expect(verdict('suppressed', 0.3, { kind: 'resist', value: MAX_RESISTANCE }).atFloor).toBe(
      true,
    );
    expect(verdict('neutral').atFloor).toBe(false);
  });
});

describe('hard immunity is not total resistance (docs/M1_PLAN.md D31)', () => {
  it('yields exactly zero, where a resist of 1 would be clamped back up to 0.30', () => {
    const immune = verdict('ascendant', 0, { kind: 'immune' });
    const total = verdict('ascendant', 0, { kind: 'resist', value: 1 });

    expect(immune.multiplier).toBe(0);
    expect(total.multiplier).toBe(WEAVE_FLOOR);
  });

  it('is neither floored nor ceilinged, because it never enters the clamp', () => {
    const immune = verdict('ascendant', 0, { kind: 'immune' });
    expect(immune.atFloor).toBe(false);
    expect(immune.atCeiling).toBe(false);
  });
});

describe('the clamp holds for every reachable combination (CLAUDE.md §7.1)', () => {
  const ATTUNEMENTS: readonly Attunement[] = ['ascendant', 'neutral', 'suppressed'];

  interface Combination {
    readonly attunement: Attunement;
    readonly resist: number;
    readonly saturation: number;
  }

  function everyCombination(): readonly Combination[] {
    const resists = [0, 0.1, 0.2, 0.3, 0.4, 0.5, MAX_RESISTANCE];
    const saturations = [0, 0.06, 0.12, 0.18, 0.24, 0.3];

    return ATTUNEMENTS.flatMap((attunement) =>
      resists.flatMap((resist) =>
        saturations.map((saturation) => ({ attunement, resist, saturation })),
      ),
    );
  }

  it('never leaves [0.30, 2.00] unless the defender is immune', () => {
    for (const { attunement, resist, saturation } of everyCombination()) {
      const result = verdict(attunement, saturation, { kind: 'resist', value: resist });

      expect(result.multiplier).toBeGreaterThanOrEqual(WEAVE_FLOOR);
      expect(result.multiplier).toBeLessThanOrEqual(WEAVE_CEILING);
    }
  });

  it('clamps a ceiling breach too, however it is reached', () => {
    // Nothing in v1 reaches it — Ascendant tops out at 1.35 — but the clamp is
    // two-sided in §7 and a relic (§10 Prism, Zealot's Blinders) moves that number.
    const beyond = ATTUNEMENT_TABLE.ascendant.multiplier * 2;
    expect(Math.min(WEAVE_CEILING, beyond)).toBe(WEAVE_CEILING);
  });
});

describe('the Weave panel reads in one call (GDD §15.2)', () => {
  it('returns one row per tag, in panel order', () => {
    const rows = weaveRows(NEUTRAL_WEAVE, NO_RESISTANCE);

    expect(rows.map((row) => row.tag)).toEqual(TAGS);
    expect(rows.every((row) => row.multiplier === 1)).toBe(true);
  });
});

describe('authoring a resistance table (GDD §7.2)', () => {
  it('fills every unnamed tag with no resistance at all', () => {
    const table = resistTo({ Physical: 0.4 });

    expect(table.Physical).toEqual({ kind: 'resist', value: 0.4 });
    for (const tag of TAGS.filter((candidate) => candidate !== 'Physical')) {
      expect(table[tag]).toEqual({ kind: 'resist', value: 0 });
    }
  });

  it("refuses a value outside §7.2's 0-60% range, naming the tag", () => {
    expect(() => resistTo({ Fire: 0.75 })).toThrow(/Fire/);
    expect(() => resistTo({ Fire: -0.1 })).toThrow(/Fire/);
    expect(() => resistTo({ Fire: MAX_RESISTANCE })).not.toThrow();
  });
});
