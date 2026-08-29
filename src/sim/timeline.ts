import { actorSpeed, isAlive, type Actor } from './actor.ts';

/**
 * Who acts next (GDD §4.1): lowest `next_act_tick`; ties break to higher
 * effective Speed, then to the lower actor index.
 *
 * GDD §20.1 describes this file as a min-heap. An encounter holds at most five
 * actors (§4.8: player plus 1–4 enemies), so a scan is the same cost as heap
 * maintenance and considerably less code to keep correct. If the actor count
 * ever grows past a handful, this is the one function to swap.
 */
export function actsBefore(candidate: Actor, incumbent: Actor): boolean {
  if (candidate.nextActTick !== incumbent.nextActTick) {
    return candidate.nextActTick < incumbent.nextActTick;
  }
  const candidateSpeed = actorSpeed(candidate);
  const incumbentSpeed = actorSpeed(incumbent);
  if (candidateSpeed !== incumbentSpeed) return candidateSpeed > incumbentSpeed;
  return candidate.index < incumbent.index;
}

/** The next living actor to act, or null if none is left alive. */
export function nextToAct(actors: readonly Actor[]): Actor | null {
  const living = actors.filter(isAlive);
  const first = living[0];
  if (first === undefined) return null;
  return living.reduce(
    (best, candidate) => (actsBefore(candidate, best) ? candidate : best),
    first,
  );
}
