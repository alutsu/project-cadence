import { TAGS, tagTable, type Tag } from './tag.ts';

/**
 * The Weave (GDD §7): what a tag is worth, right now, against this defender.
 *
 *     final = clamp(attunement × (1 − resist) × (1 − saturation), 0.30, 2.00)
 *
 * The clamp is mandatory, not defensive — §7.4 records it as a fix for a real
 * v0.1 bug where three stacked reductions multiplied out to ×0.196 and bricked
 * a build the design promised could never be bricked.
 *
 * This module returns a **verdict**, never its components. GDD §15.2 requires
 * the panel to show the final number and a distinct indicator when the floor is
 * active, and CLAUDE.md §2.1 forbids the UI from doing the multiplication — so
 * the one thing a caller must never have to do is combine two of these fields.
 */

/** GDD §7.1: two tags are raised and two are pushed down at run start. */
export const ATTUNEMENTS = ['ascendant', 'neutral', 'suppressed'] as const;

export type Attunement = (typeof ATTUNEMENTS)[number];

export interface AttunementProfile {
  readonly multiplier: number;
  /**
   * Signed ticks, and deliberately **not** a `Tick` (docs/M1_PLAN.md D17):
   * `tick()` rejects a negative, so an Ascendant −1 typed as `Tick` would throw
   * at load rather than at combat time. Riders are summed as numbers and
   * branded exactly once, at the end of resolution.
   */
  readonly weightDelta: number;
}

/** GDD §7.1: Ascendant ×1.35 and −1 Weight; Suppressed ×0.70 and +1 Weight. */
export const ATTUNEMENT_TABLE: Readonly<Record<Attunement, AttunementProfile>> = {
  ascendant: { multiplier: 1.35, weightDelta: -1 },
  neutral: { multiplier: 1, weightDelta: 0 },
  suppressed: { multiplier: 0.7, weightDelta: 1 },
};

/** GDD §7: the clamp that keeps a floored build playable rather than dead. */
export const WEAVE_FLOOR = 0.3;
export const WEAVE_CEILING = 2;

/** GDD §7.2: generated enemies carry up to 60% resistance to a tag. */
export const MAX_RESISTANCE = 0.6;

/**
 * GDD §7.2. Immunity is **not** `resist = 1`: the §7 clamp would raise ×0 back
 * to ×0.30 and quietly turn "immune" into "70% resistant" (docs/M1_PLAN.md
 * D31). Modelling it as its own case is what keeps the clamp from swallowing
 * it. Elites are M2's, but the type is authored now — retrofitting it after the
 * clamp has shipped means auditing every call site instead of one.
 */
export type TagResistance =
  { readonly kind: 'resist'; readonly value: number } | { readonly kind: 'immune' };

export type ResistanceTable = Readonly<Record<Tag, TagResistance>>;

const NO_RESIST: TagResistance = { kind: 'resist', value: 0 };

/** An actor that resists nothing — every enemy until §12.1's generator lands. */
export const NO_RESISTANCE: ResistanceTable = tagTable(NO_RESIST);

/**
 * A full table from the handful of tags an archetype actually cares about.
 *
 * Authoring all six per enemy would bury the two that matter under four zeroes,
 * and §7.2's range is a *cap on each tag*, not a budget across them — so the
 * check belongs here, once, rather than in every data file.
 */
export function resistTo(resisted: Partial<Record<Tag, number>>): ResistanceTable {
  const table = { ...tagTable(NO_RESIST) };

  for (const tag of TAGS) {
    const value = resisted[tag];
    if (value === undefined) continue;
    if (!Number.isFinite(value) || value < 0 || value > MAX_RESISTANCE) {
      throw new RangeError(
        `${tag} resistance must be within 0..${String(MAX_RESISTANCE)}, received ${String(value)}`,
      );
    }
    table[tag] = { kind: 'resist', value };
  }

  return table;
}

/**
 * What the run layer hands to combat: where every tag stands this encounter.
 * Plain and serializable (CLAUDE.md §2.2), and carried *in* `CombatState` so
 * two otherwise-identical states cannot behave differently.
 */
export interface WeaveSnapshot {
  readonly attunement: Readonly<Record<Tag, Attunement>>;
  /** GDD §7.3, per tag, already capped by the run layer's fold. */
  readonly saturation: Readonly<Record<Tag, number>>;
  /**
   * What each slot is worth (GDD §7.1).
   *
   * Carried here rather than read from `ATTUNEMENT_TABLE`, because §10's Weave
   * relics rewrite it — Prism caps Ascendant at 1.15 and lifts Suppressed to
   * 0.85, Zealot's Blinders raises Ascendant to 1.7. A module constant cannot be
   * rewritten per run without two otherwise-identical states behaving
   * differently, which is the same argument `rules` already lives here for.
   *
   * Optional so that M0's every test and the harness keep meaning the published
   * table without saying so.
   */
  readonly profiles?: Readonly<Record<Attunement, AttunementProfile>>;
}

/** No tag raised, none pushed down, nothing saturated. The M0 baseline. */
export const NEUTRAL_WEAVE: WeaveSnapshot = {
  attunement: tagTable<Attunement>('neutral'),
  saturation: tagTable(0),
};

/**
 * One tag's standing, fully worked out. Every field the panel and the hover
 * need, and no field either of them has to combine with another.
 */
export interface TagVerdict {
  readonly tag: Tag;
  readonly attunement: Attunement;
  readonly resistance: TagResistance;
  readonly saturation: number;
  /**
   * The product before the clamp. The panel does not print it; it is what lets
   * the floor indicator explain *why* the number stopped moving (P3).
   */
  readonly raw: number;
  /** The number that multiplies damage: 0 when immune, else inside the clamp. */
  readonly multiplier: number;
  /** GDD §7.4: the distinct icon's condition, not a threshold the UI guesses. */
  readonly atFloor: boolean;
  readonly atCeiling: boolean;
  /** GDD §7.1's ±1 rider. Signed ticks — see AttunementProfile. */
  readonly weightDelta: number;
}

export interface WeaveQuery {
  readonly tag: Tag;
  readonly weave: WeaveSnapshot;
  readonly resistances: ResistanceTable;
}

/**
 * GDD §7, in one place. An immune defender short-circuits: it yields ×0 and is
 * neither floored nor ceilinged, because it never entered the clamp.
 */
export function weaveVerdict(query: WeaveQuery): TagVerdict {
  const { tag, weave, resistances } = query;
  const attunement = weave.attunement[tag];
  const saturation = weave.saturation[tag];
  const resistance = resistances[tag];
  const profile = (weave.profiles ?? ATTUNEMENT_TABLE)[attunement];

  const shared = {
    tag,
    attunement,
    resistance,
    saturation,
    weightDelta: profile.weightDelta,
  };

  if (resistance.kind === 'immune') {
    return { ...shared, raw: 0, multiplier: 0, atFloor: false, atCeiling: false };
  }

  const raw = profile.multiplier * (1 - resistance.value) * (1 - saturation);
  const multiplier = Math.min(WEAVE_CEILING, Math.max(WEAVE_FLOOR, raw));

  return {
    ...shared,
    raw,
    multiplier,
    atFloor: raw < WEAVE_FLOOR,
    atCeiling: raw > WEAVE_CEILING,
  };
}

/**
 * Every tag's standing against one defender — the Weave panel in a single call
 * (GDD §15.2: one row per tag, glyph, name, final multiplier, floor indicator).
 */
export function weaveRows(
  weave: WeaveSnapshot,
  resistances: ResistanceTable,
): readonly TagVerdict[] {
  return TAGS.map((tag) => weaveVerdict({ tag, weave, resistances }));
}
