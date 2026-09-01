import type { Attunement } from './weave.ts';

/**
 * The relic atom registry (GDD §10, docs/M2_PLAN.md D39).
 *
 * §10's relics are not one lever: Metronome zeroes an action's Weight, Undertow
 * adds a tick to Stagger and takes Speed, Prism rewrites §7.1's multipliers,
 * Glass Sigil scales damage in both directions, Prospector's Eye touches only
 * the ledger. A `switch` over relic ids would grow a case per relic and
 * CLAUDE.md §4.2 forbids exactly that, so this mirrors M1's effect atoms: a
 * relic is **data** naming registered atoms, and an atom is **code** that
 * writes one lever.
 *
 * Being honest about the boundary, as M1 D33 was: the *relics* are the open
 * part and the *levers* are the closed part. A relic needing a lever nobody has
 * is a real design change and should be a real edit here, not a silent
 * extension point. An unregistered atom throws at load, naming the offender.
 */

/** One entry from `relics.json`. `slot` is only read by `ATTUNEMENT_MULT`. */
export interface RelicAtom {
  readonly type: string;
  readonly value: number;
  readonly slot: Attunement | null;
}

/**
 * Everything a relic can change, folded across every relic held.
 *
 * Deliberately flat and serializable: this is derived from the relics a run
 * holds, so it is never saved — recomputing it is cheaper than keeping it
 * honest.
 */
export interface RelicLevers {
  /** GDD §10 Metronome: the encounter's first action is free. */
  readonly freeFirstWeight: boolean;
  /** Added to every resolved card's Weight, floored at 1 by `resolve`. */
  readonly weightDelta: number;
  /** GDD §4.6: extra ticks on a Stagger this actor applies. */
  readonly staggerTicks: number;
  readonly speedDelta: number;
  /** GDD §4.3: cards the Guard action draws, and Guard it puts up. */
  readonly guardDraw: number;
  readonly guardGain: number;
  /** Multipliers, already resolved from their additive atoms — 1 is neutral. */
  readonly damageDealtMult: number;
  readonly damageTakenMult: number;
  /** GDD §7.1 overrides. Null leaves the published value alone. */
  readonly attunement: Readonly<Record<Attunement, number | null>>;
  /** GDD §7.3's cap, when a relic moves it. */
  readonly saturationCap: number | null;
  /** GDD §6.1: percentage points off a socket's Max HP cost. */
  readonly socketCostDelta: number;
  /** GDD §10 Bone Ledger: a failed attempt Scars a second card too. */
  readonly scarSpreads: boolean;
  /** GDD §9 multipliers on what a cleared encounter pays. */
  readonly goldMult: number;
  readonly eliteMaterialTier: number;
}

export const NO_LEVERS: RelicLevers = {
  freeFirstWeight: false,
  weightDelta: 0,
  staggerTicks: 0,
  speedDelta: 0,
  guardDraw: 0,
  guardGain: 0,
  damageDealtMult: 1,
  damageTakenMult: 1,
  attunement: { ascendant: null, neutral: null, suppressed: null },
  saturationCap: null,
  socketCostDelta: 0,
  scarSpreads: false,
  goldMult: 1,
  eliteMaterialTier: 0,
};

/** An atom folds itself into the levers. Pure, and order-independent. */
export type RelicAtomHandler = (levers: RelicLevers, atom: RelicAtom) => RelicLevers;

const HANDLERS = new Map<string, RelicAtomHandler>();

export function registerRelicAtom(type: string, handler: RelicAtomHandler): void {
  HANDLERS.set(type, handler);
}

export function isRegisteredRelicAtom(type: string): boolean {
  return HANDLERS.has(type);
}

export function relicAtomHandler(type: string): RelicAtomHandler {
  const handler = HANDLERS.get(type);
  if (handler === undefined) throw new Error(`no relic atom registered for "${type}"`);
  return handler;
}

/** Folds every atom of every held relic into one set of levers. */
export function foldRelicAtoms(atoms: readonly RelicAtom[]): RelicLevers {
  return atoms.reduce<RelicLevers>(
    (levers, atom) => relicAtomHandler(atom.type)(levers, atom),
    NO_LEVERS,
  );
}

/**
 * A multiplier atom is authored as the *change* (+0.3 for "30% more"), because
 * that is how §10 words it, and two such relics should compound rather than the
 * second silently replacing the first.
 */
function scaled(current: number, by: number): number {
  return current * (1 + by);
}

registerRelicAtom('FREE_FIRST_WEIGHT', (levers) => ({ ...levers, freeFirstWeight: true }));
registerRelicAtom('WEIGHT_DELTA', (levers, atom) => ({
  ...levers,
  weightDelta: levers.weightDelta + atom.value,
}));
registerRelicAtom('STAGGER_TICKS', (levers, atom) => ({
  ...levers,
  staggerTicks: levers.staggerTicks + atom.value,
}));
registerRelicAtom('SPEED_DELTA', (levers, atom) => ({
  ...levers,
  speedDelta: levers.speedDelta + atom.value,
}));
registerRelicAtom('GUARD_DRAW', (levers, atom) => ({
  ...levers,
  guardDraw: levers.guardDraw + atom.value,
}));
registerRelicAtom('GUARD_GAIN', (levers, atom) => ({
  ...levers,
  guardGain: levers.guardGain + atom.value,
}));
registerRelicAtom('DAMAGE_DEALT_MULT', (levers, atom) => ({
  ...levers,
  damageDealtMult: scaled(levers.damageDealtMult, atom.value),
}));
registerRelicAtom('DAMAGE_TAKEN_MULT', (levers, atom) => ({
  ...levers,
  damageTakenMult: scaled(levers.damageTakenMult, atom.value),
}));
registerRelicAtom('SATURATION_CAP', (levers, atom) => ({
  ...levers,
  saturationCap: atom.value,
}));
registerRelicAtom('SOCKET_COST_DELTA', (levers, atom) => ({
  ...levers,
  socketCostDelta: levers.socketCostDelta + atom.value,
}));
registerRelicAtom('SCAR_SPREADS', (levers) => ({ ...levers, scarSpreads: true }));
registerRelicAtom('GOLD_MULT', (levers, atom) => ({
  ...levers,
  goldMult: scaled(levers.goldMult, atom.value),
}));
registerRelicAtom('ELITE_MATERIAL_TIER', (levers, atom) => ({
  ...levers,
  eliteMaterialTier: levers.eliteMaterialTier + atom.value,
}));

/**
 * GDD §7.1's multipliers, per slot.
 *
 * Two relics writing the same slot is a real possibility — Prism caps Ascendant
 * at 1.15 and Zealot's Blinders raises it to 1.7 — and the player holding both
 * should get the *worse* of the two rather than whichever loaded last, because
 * §10 promises the drawback is real and load order is not a game rule.
 */
registerRelicAtom('ATTUNEMENT_MULT', (levers, atom) => {
  const slot = atom.slot;
  if (slot === null) return levers;

  const standing = levers.attunement[slot];
  const value = standing === null ? atom.value : Math.min(standing, atom.value);

  return { ...levers, attunement: { ...levers.attunement, [slot]: value } };
});
