import { tick, type Tick } from './tick.ts';

/**
 * The knobs M0 needs to tune during the feel hour (docs/M0_PLAN.md §4, S8).
 *
 * Rules live *in* CombatState rather than in module constants, so changing one
 * cannot make two otherwise-identical states behave differently — tuning stays
 * deterministic and a saved encounter still replays (GDD §20.2).
 */
export type UltimateRule = 'immediate' | 'windup' | 'refund' | 'insight';

export const ULTIMATE_RULES: readonly UltimateRule[] = ['immediate', 'windup', 'refund', 'insight'];

export interface CombatRules {
  /** GDD §22, open question 1. See ULTIMATE_RULE_NOTES. */
  readonly ultimate: UltimateRule;
  /** GDD §4.4, open question 6 — untested numbers, hence tunable. */
  readonly guardCap: number;
  /**
   * Ticks per point of Guard lost (GDD §4.4 [AMD]).
   *
   * v0.2 said one point *per tick*, which made Guard arithmetic that never
   * mattered: the Guard action grants 3, so it was gone in three ticks of a
   * forty-tick fight. Three playtests running recorded Guard absorbing nothing
   * in 23 of 25, then 8 of 9 fights — §4.4 makes Guard the game's only
   * mitigation, and one of the six systems was inert.
   */
  readonly guardDecayEvery: number;
  /** GDD §4.3: what the Guard action costs, and what it puts up. */
  readonly guardWeight: Tick;
  readonly guardGain: number;
  /** GDD §4.6: the first Stagger's delay, before the ladder halves it. */
  readonly firstStagger: number;
}

export const DEFAULT_RULES: CombatRules = {
  ultimate: 'immediate',
  guardCap: 40,
  guardDecayEvery: 3,
  guardWeight: tick(3),
  guardGain: 3,
  firstStagger: 3,
};

/** What each candidate rule is actually testing (GDD §22 Q1). */
export const ULTIMATE_RULE_NOTES: Readonly<Record<UltimateRule, string>> = {
  immediate: 'baseline — Weight 16 up front',
  windup: 'commit now, lands later, keep acting',
  refund: 'up front, half back on a kill',
  // GDD §22 Q1 candidate (b). M0 could not test it — there was no Insight
  // system to reward — and docs/M0_GATE.md §3 says so explicitly. There is one
  // now, so the candidate finally has a meaning (docs/M1_PLAN.md D25).
  insight: 'up front, and a kill pays Insight',
};

/** GDD §22 Q1 candidate (b): what an Ultimate kill is worth, in Insight. */
export const ULTIMATE_KILL_INSIGHT = 1;

/** The wind-up variant leaves the player free again after this much Weight. */
export const WINDUP_COMMIT_WEIGHT: Tick = tick(4);
