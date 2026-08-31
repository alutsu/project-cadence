import type { Rng } from '../sim/rng.ts';
import { TAGS, tagTable, type Tag } from '../sim/tag.ts';
import type { Attunement } from '../sim/weave.ts';

/**
 * The Attunement roll and its shift schedule (GDD §7.1).
 *
 * > Run start rolls 2 Ascendant (×1.35, −1 Weight) and 2 Suppressed (×0.70,
 * > +1 Weight). The full Attunement is visible at run start; it re-rolls one
 * > Ascendant and one Suppressed slot at the start of Depth 2 and Depth 3 only.
 *
 * Two of each out of six tags (docs/M1_PLAN.md D15) leaves two neutral — enough
 * of the deck moves to force adaptation, not so much that everything does.
 */

export const ASCENDANT_SLOTS = 2;
export const SUPPRESSED_SLOTS = 2;

export type AttunementTable = Readonly<Record<Tag, Attunement>>;

/**
 * Draws `count` distinct tags, and **always draws exactly `count` times**
 * whatever it picks (docs/M1_PLAN.md D32).
 *
 * Rejection sampling would make the stream position depend on the outcome, and
 * a stream position that depends on its own result cannot be resumed from a
 * save — the run would silently diverge from the one that was saved (§20.2).
 * Drawing an index into a shrinking pool costs one draw per pick, always.
 */
function drawDistinct(rng: Rng, pool: readonly Tag[], count: number): readonly Tag[] {
  const remaining = [...pool];
  const drawn: Tag[] = [];

  for (let pick = 0; pick < count; pick += 1) {
    if (remaining.length === 0) break;
    const [taken] = remaining.splice(rng.nextInt(remaining.length), 1);
    if (taken !== undefined) drawn.push(taken);
  }

  return drawn;
}

function tableFrom(ascendant: readonly Tag[], suppressed: readonly Tag[]): AttunementTable {
  const table: Record<Tag, Attunement> = { ...tagTable<Attunement>('neutral') };
  for (const tag of ascendant) table[tag] = 'ascendant';
  for (const tag of suppressed) table[tag] = 'suppressed';
  return table;
}

/** GDD §7.1: the whole Attunement, visible from the first screen of the run. */
export function rollAttunement(rng: Rng): AttunementTable {
  const ascendant = drawDistinct(rng, TAGS, ASCENDANT_SLOTS);
  const rest = TAGS.filter((tag) => !ascendant.includes(tag));
  return tableFrom(ascendant, drawDistinct(rng, rest, SUPPRESSED_SLOTS));
}

function tagsAt(table: AttunementTable, standing: Attunement): readonly Tag[] {
  return TAGS.filter((tag) => table[tag] === standing);
}

/**
 * GDD §7.1's shift: **one** Ascendant slot and **one** Suppressed slot re-roll.
 *
 * Announced at the end of the preceding Depth, so it is something to plan
 * around rather than something that happens to you. The vacated tag can be
 * drawn again — the shift is a re-roll, not a guaranteed change, and forcing a
 * change would make the schedule more predictable rather than less.
 */
export function shiftAttunement(rng: Rng, table: AttunementTable): AttunementTable {
  const ascendant = tagsAt(table, 'ascendant');
  const suppressed = tagsAt(table, 'suppressed');

  const [droppedUp] = drawDistinct(rng, ascendant, 1);
  const [droppedDown] = drawDistinct(rng, suppressed, 1);

  const keptUp = ascendant.filter((tag) => tag !== droppedUp);
  const keptDown = suppressed.filter((tag) => tag !== droppedDown);
  const free = TAGS.filter((tag) => !keptUp.includes(tag) && !keptDown.includes(tag));

  const [raised] = drawDistinct(rng, free, 1);
  const stillFree = free.filter((tag) => tag !== raised);
  const [lowered] = drawDistinct(rng, stillFree, 1);

  return tableFrom(
    raised === undefined ? keptUp : [...keptUp, raised],
    lowered === undefined ? keptDown : [...keptDown, lowered],
  );
}
