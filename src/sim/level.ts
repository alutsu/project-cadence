/**
 * Levels, XP and Threat (GDD §5.1–5.3).
 *
 * Pure arithmetic over the published table, in `/sim` because it is a rule the
 * harness has to be able to run headlessly. The *deck* a level grants is
 * authored data (§5.1) and lives in `/data`; this module only counts.
 */

/** GDD §5.1: twelve levels, and the twelfth is the capstone. */
export const MAX_LEVEL = 12;
export const STARTING_LEVEL = 1;

/** GDD §5.1 [FIX]: Max HP grows +6 per level, 70 at level 1 to 136 at 12. */
export const BASE_MAX_HP = 70;
export const MAX_HP_PER_LEVEL = 6;

/** GDD §5.1: 4 starters + 1 signature at level 1, one skill per level after. */
export const STARTING_DECK_SIZE = 5;

export function clampLevel(level: number): number {
  return Math.min(MAX_LEVEL, Math.max(STARTING_LEVEL, Math.trunc(level)));
}

/** The published table's Max HP column, as a function (GDD §5.1). */
export function maxHpAtLevel(level: number): number {
  return BASE_MAX_HP + (clampLevel(level) - STARTING_LEVEL) * MAX_HP_PER_LEVEL;
}

/** The published table's deck-size column: 5 at level 1, 16 at the cap. */
export function deckSizeAtLevel(level: number): number {
  return STARTING_DECK_SIZE + (clampLevel(level) - STARTING_LEVEL);
}

/**
 * XP to reach the *next* level (docs/M2_PLAN.md D42).
 *
 * §5.2 gives the formula for how much XP an encounter *awards* but never what a
 * level *costs*, so the curve is chosen here and stated rather than buried. It
 * is tuned against §11's run: twelve normal encounters, four elites and four
 * bosses award roughly 380 base XP between them, and the eleven level-ups below
 * cost 385 — so a run reaches somewhere near the cap, and a run that dawdles
 * does not overshoot it because §5.3's Threat pushes enemies up to meet you.
 */
export const XP_FIRST_LEVEL = 15;
export const XP_LEVEL_STEP = 4;

export function xpToNextLevel(level: number): number {
  if (clampLevel(level) >= MAX_LEVEL) return Number.POSITIVE_INFINITY;
  return XP_FIRST_LEVEL + (clampLevel(level) - STARTING_LEVEL) * XP_LEVEL_STEP;
}

/**
 * GDD §5.2, verbatim:
 *
 *     xp = base_xp * clamp(1 + 0.18 * (enemy_level - player_level), 0.10, 1.80)
 *
 * The clamp is what stops farming below your level from paying and stops a
 * single over-levelled fight from carrying a run.
 */
export const XP_LEVEL_WEIGHT = 0.18;
export const XP_SCALE_MIN = 0.1;
export const XP_SCALE_MAX = 1.8;

export function xpAwarded(spec: {
  readonly baseXp: number;
  readonly enemyLevel: number;
  readonly playerLevel: number;
}): number {
  const scale = 1 + XP_LEVEL_WEIGHT * (spec.enemyLevel - spec.playerLevel);
  return Math.round(spec.baseXp * Math.min(XP_SCALE_MAX, Math.max(XP_SCALE_MIN, scale)));
}

export interface Progress {
  readonly level: number;
  readonly xp: number;
}

/**
 * XP banked, and any levels it bought. Levels are granted one at a time so a
 * huge award cannot skip the skill a level is supposed to hand over (§5.1:
 * "Level N grants skill N, always, in order").
 */
export function bankXp(progress: Progress, awarded: number): Progress {
  let { level, xp } = { level: clampLevel(progress.level), xp: progress.xp + awarded };

  while (level < MAX_LEVEL && xp >= xpToNextLevel(level)) {
    xp -= xpToNextLevel(level);
    level += 1;
  }

  return { level, xp: level >= MAX_LEVEL ? 0 : xp };
}

/**
 * GDD §5.3: `enemy_level = depth_base + floor(Threat / 2)`.
 *
 * Farming pushes enemies past you rather than behind you — self-limiting, and
 * it needs no timer on screen to say so.
 */
export const THREAT_PER_NODE = 1;

export function enemyLevel(depthBase: number, threat: number): number {
  return depthBase + Math.floor(threat / 2);
}
