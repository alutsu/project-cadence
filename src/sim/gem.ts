import type { CardId, GemId } from './ids.ts';
import type { Tag } from './tag.ts';

/**
 * Gems and where they sit (GDD §6.2, §6.1).
 *
 * Plain, serializable data and nothing else: no rolling happens here, and no
 * effect is interpreted here. A gem is a *record of a roll* that already
 * happened in the run layer, which is what keeps the `gemRoll` stream from ever
 * advancing during combat (docs/M1_PLAN.md §3.3).
 */

/** GDD §6.2's ten frames. A frame is a recipe, not code — see gemEffects.ts. */
export type Frame =
  | 'REPEAT'
  | 'CHARGE'
  | 'SPEND'
  | 'SIPHON'
  | 'BREAK'
  | 'HASTE'
  | 'KINDLE'
  | 'ECHO'
  | 'WARD'
  | 'LINGER';

export const FRAMES: readonly Frame[] = [
  'REPEAT',
  'CHARGE',
  'SPEND',
  'SIPHON',
  'BREAK',
  'HASTE',
  'KINDLE',
  'ECHO',
  'WARD',
  'LINGER',
];

const FRAME_NAMES: readonly string[] = FRAMES;

export function isFrame(value: unknown): value is Frame {
  return typeof value === 'string' && FRAME_NAMES.includes(value);
}

/** GDD §6.2: material rarity sets the tier, and the tier scales the roll. */
export type GemTier = 1 | 2 | 3 | 4;

export const GEM_TIERS: readonly GemTier[] = [1, 2, 3, 4];

export function isGemTier(value: unknown): value is GemTier {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

/**
 * One rolled lever. `type` names a registered effect atom (gemEffects.ts) and
 * `value` is what this particular gem rolled for it — already a constant by the
 * time combat sees it.
 */
export interface GemEffect {
  readonly type: string;
  readonly value: number;
  /**
   * The tag this effect names, for the one atom whose parameter is not a
   * magnitude: KINDLE converts damage *to* something (GDD §6.2). Explicitly
   * null rather than optional, so "this atom takes no tag" is a stated fact
   * rather than a field somebody forgot (CLAUDE.md §3.2).
   */
  readonly tag: Tag | null;
}

/** GDD §6.2's gem shape, as it appears in the JSON. */
export interface Gem {
  readonly id: GemId;
  readonly frame: Frame;
  readonly tier: GemTier;
  /**
   * Descriptive vocabulary — 'Multi', 'Charge' and the like (GDD §6.2's own
   * example). Deliberately *not* Weave tags (docs/M1_PLAN.md D15): the Weave
   * prices what a card is made of, and a gem is not made of anything.
   */
  readonly words: readonly string[];
  /**
   * The gem's Weight rider, signed. First-class rather than an effect atom
   * because §6.2's example puts it at the top level of the gem while putting
   * Recovery in the affix list — this mirrors that shape rather than inventing
   * a symmetry the design does not have.
   */
  readonly weightDelta: number;
  /** What the frame does, and what it costs. Every frame carries both (§6.2). */
  readonly effects: readonly GemEffect[];
  /** Rolled from the shared pool (§17 budgets 20), independent of the frame. */
  readonly affixes: readonly GemEffect[];
}

export type GemCatalogue = Readonly<Record<string, Gem>>;

/** GDD §6.1: a card carries 0–3 sockets, and what sits in them. */
export interface CardSockets {
  readonly opened: number;
  /**
   * An array, not a record, because order is meaning: a KINDLE conversion is
   * last-wins and a damage multiplier is a product, so two gems in the other
   * order are a different card. A record keyed by gem id would leave that
   * order to whatever the runtime felt like.
   */
  readonly gems: readonly GemId[];
  /** GDD §6.1: a failed attempt marks the card, +50% on the next one. */
  readonly scarred: boolean;
}

export const NO_SOCKETS: CardSockets = { opened: 0, gems: [], scarred: false };

/**
 * What a gem has accumulated *this fight* (GDD §6.2: CHARGE gains charges on a
 * kill, ECHO fires once). Generic counters the frames interpret, rather than a
 * field per frame — a frame that needs a third counter is a design change, and
 * should look like one.
 *
 * Rebuilt at `startCombat` and never carried between encounters, which is what
 * keeps a charge from surviving a fight it was not earned in.
 */
export interface GemRuntime {
  readonly charges: number;
  readonly uses: number;
}

export const FRESH_RUNTIME: GemRuntime = { charges: 0, uses: 0 };

/**
 * The build, as combat sees it. Keyed by card id, so a plain record survives
 * `structuredClone` and a save (CLAUDE.md §2.2 — no Map in a persisted shape).
 */
export interface BuildState {
  readonly gems: GemCatalogue;
  readonly sockets: Readonly<Record<string, CardSockets>>;
  readonly runtime: Readonly<Record<string, GemRuntime>>;
}

/** No sockets, no gems — every M0 test and the harness, unchanged. */
export const EMPTY_BUILD: BuildState = { gems: {}, sockets: {}, runtime: {} };

/** A build at the start of an encounter: every seated gem back to zero. */
export function freshBuild(build: BuildState): BuildState {
  const runtime: Record<string, GemRuntime> = {};
  for (const sockets of Object.values(build.sockets)) {
    for (const id of sockets.gems) runtime[id] = FRESH_RUNTIME;
  }
  return { ...build, runtime };
}

export function runtimeOf(build: BuildState, gem: GemId): GemRuntime {
  return build.runtime[gem] ?? FRESH_RUNTIME;
}

/** What is actually seated in this card, in socket order. */
export function gemsIn(build: BuildState, card: CardId): readonly Gem[] {
  const seated = build.sockets[card]?.gems ?? [];
  return seated.map((id) => build.gems[id]).filter((gem): gem is Gem => gem !== undefined);
}
