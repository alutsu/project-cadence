/**
 * The Weave's tag taxonomy (GDD §7, docs/M1_PLAN.md D15).
 *
 * Six tags, exactly one per card. The number is load-bearing: §7.1 makes two
 * tags Ascendant and two Suppressed at run start, so six leaves two neutral and
 * a third of the deck moves on each roll — enough to force adaptation, not
 * enough to brick a build (the §7.4 concern).
 *
 * Words like Multi, Charge and Break, which §6.2 and §8.1 also call "tags", are
 * gem and frame vocabulary. They name what a gem does; the Weave has nothing to
 * multiply them by, and they are deliberately not part of this union.
 */
export type Tag = 'Physical' | 'Fire' | 'Frost' | 'Arcane' | 'Shadow' | 'Storm';

/** Every tag, in panel order (GDD §15.2: one row per tag). */
export const TAGS: readonly Tag[] = ['Physical', 'Fire', 'Frost', 'Arcane', 'Shadow', 'Storm'];

/**
 * GDD §15.2, and it is marked *critical* there: a tag carries mechanical
 * meaning and must **never** be encoded in colour alone. The glyph is therefore
 * a property of the tag, authored with the taxonomy — not a styling choice a
 * view is free to omit. It lives here beside the name for the same reason an
 * actor's name lives in `/sim`: both are what the thing *is called*, and the
 * headless harness needs to print them as much as the panel does.
 */
export const TAG_GLYPHS: Readonly<Record<Tag, string>> = {
  Physical: '◆',
  Fire: '▲',
  Frost: '❋',
  Arcane: '◇',
  Shadow: '●',
  Storm: '⋔',
};

const TAG_NAMES: readonly string[] = TAGS;

export function isTag(value: unknown): value is Tag {
  return typeof value === 'string' && TAG_NAMES.includes(value);
}

/** A full table with the same value in every slot — the base for a real one. */
export function tagTable<T>(fill: T): Readonly<Record<Tag, T>> {
  return {
    Physical: fill,
    Fire: fill,
    Frost: fill,
    Arcane: fill,
    Shadow: fill,
    Storm: fill,
  };
}
