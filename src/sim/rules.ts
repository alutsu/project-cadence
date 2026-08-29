import { tick, type Tick } from './tick.ts';

/**
 * The knobs M0 needs to tune during the feel hour (docs/M0_PLAN.md §4, S8).
 *
 * Rules live *in* CombatState rather than in module constants, so changing one
 * cannot make two otherwise-identical states behave differently — tuning stays
 * deterministic and a saved encounter still replays (GDD §20.2).
 */
export type UltimateRule = 'immediate' | 'windup' | 'refund';

export const ULTIMATE_RULES: readonly UltimateRule[] = ['immediate', 'windup', 'refund'];

export interface CombatRules {
  /** GDD §22, open question 1. See ULTIMATE_RULE_NOTES. */
  readonly ultimate: UltimateRule;
  /** GDD §4.4, open question 6 — untested numbers, hence tunable. */
  readonly guardCap: number;
  readonly guardDecayPerTick: number;
  readonly waitWeight: Tick;
  readonly waitGuard: number;
  /** GDD §4.6: the first Stagger's delay, before the ladder halves it. */
  readonly firstStagger: number;
}

export const DEFAULT_RULES: CombatRules = {
  ultimate: 'immediate',
  guardCap: 40,
  guardDecayPerTick: 1,
  waitWeight: tick(3),
  waitGuard: 3,
  firstStagger: 3,
};

/** What each candidate rule is actually testing (GDD §22 Q1). */
export const ULTIMATE_RULE_NOTES: Readonly<Record<UltimateRule, string>> = {
  immediate: 'baseline — Weight 16 up front',
  windup: 'commit now, lands later, keep acting',
  refund: 'up front, half back on a kill',
};

/** The wind-up variant leaves the player free again after this much Weight. */
export const WINDUP_COMMIT_WEIGHT: Tick = tick(4);
