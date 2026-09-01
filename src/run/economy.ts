import type { GemTier } from '../sim/gem.ts';
import type { Rng } from '../sim/rng.ts';

/**
 * The §9 ledger.
 *
 * v0.1 of the design spent gold in three places and never said where gold came
 * from; §9 is the table that fixed that, and this is that table. Every source
 * and every price lives here so the economy can be read in one place and tuned
 * in one place (CLAUDE.md §5.1) — a price in a method body is a price nobody
 * can find when the balance pass moves it.
 *
 * §9's closing line is a rule and not a note: **nothing carries between runs.**
 * Gold, materials and Insight are all fields of `RunState` for that reason, and
 * there is deliberately no persistent wallet anywhere for them to leak into.
 */

/** What a cleared encounter was, for the purpose of paying for it (§9). */
export type RewardKind = 'normal' | 'elite' | 'boss';

interface RewardRule {
  readonly goldLow: number;
  readonly goldHigh: number;
  readonly materialTier: GemTier;
  /**
   * Chance of the material dropping. 1 is guaranteed — and the roll is still
   * drawn, because a draw that depends on its own outcome cannot be resumed
   * (docs/M1_PLAN.md D32).
   */
  readonly materialChance: number;
  readonly insight: number;
  /** §9's XP column: base, ×2.5, ×4. */
  readonly xpFactor: number;
}

/** GDD §9's sources table, verbatim. */
const REWARDS: Readonly<Record<RewardKind, RewardRule>> = {
  normal: {
    goldLow: 15,
    goldHigh: 25,
    materialTier: 1,
    materialChance: 0.35,
    insight: 0,
    xpFactor: 1,
  },
  elite: {
    goldLow: 40,
    goldHigh: 60,
    materialTier: 2,
    materialChance: 1,
    insight: 0,
    xpFactor: 2.5,
  },
  boss: {
    goldLow: 100,
    goldHigh: 140,
    materialTier: 3,
    materialChance: 1,
    insight: 1,
    xpFactor: 4,
  },
};

export function rewardRuleFor(kind: RewardKind): RewardRule {
  return REWARDS[kind];
}

export interface Reward {
  readonly gold: number;
  readonly material: GemTier | null;
  readonly insight: number;
}

/**
 * What clearing an encounter pays. **Always two draws**, whatever the kind:
 * the gold, then the material chance even where the chance is 1. A roll that
 * skips a draw when it already knows the answer makes the stream position
 * depend on the outcome, and a resumed run then diverges (D32).
 */
export function rollReward(kind: RewardKind, rng: Rng): Reward {
  const rule = REWARDS[kind];
  const gold = rule.goldLow + Math.round(rng.nextFloat() * (rule.goldHigh - rule.goldLow));
  const dropped = rng.nextFloat() < rule.materialChance;

  return {
    gold,
    material: dropped ? rule.materialTier : null,
    insight: rule.insight,
  };
}

/**
 * §9: card removal costs 60 → 120 → 240 → 480 gold.
 *
 * Four rungs, and §9 gives no fifth. That is not an omission to paper over: the
 * four together cost 900 and a run is expected to see about 450, so the ladder
 * outruns the wallet long before it runs out of rungs. A fifth removal is
 * refused rather than invented (`REMOVAL_LADDER.length` is the cap).
 */
export const REMOVAL_LADDER: readonly number[] = [60, 120, 240, 480];

export function removalPrice(removed: number): number | null {
  return REMOVAL_LADDER[removed] ?? null;
}

/**
 * §9: materials cost 40 (T1) / 90 (T2) / 200 (T3).
 *
 * There is no Sigil price, and that is deliberate in the design: a T4 material
 * can only be made by upgrading three Hearts (§9's ladder), so the top tier is
 * always earned rather than bought.
 */
export const MATERIAL_PRICES: Readonly<Partial<Record<GemTier, number>>> = {
  1: 40,
  2: 90,
  3: 200,
};

export function materialPrice(tier: GemTier): number | null {
  return MATERIAL_PRICES[tier] ?? null;
}
