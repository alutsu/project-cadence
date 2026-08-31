import { GEM_TIERS, type GemTier } from '../sim/gem.ts';

/**
 * The material ladder (GDD §9).
 *
 * > Shard (T1) → Core (T2) → Heart (T3) → Sigil (T4). Three of a tier upgrade
 * > into one of the next.
 *
 * The rule is M1's rather than M2's because material rarity is what sets a
 * crafted gem's Tier (§6.2) — without it, crafting has no input. Gold, the
 * Market and card removal stay with the economy (docs/M1_PLAN.md D20).
 *
 * The upgrade is what gives a low-tier drop a permanent floor of value: three
 * Shards found in Depth 1 are still worth something in Depth 4, so loot never
 * goes dead.
 */

export const UPGRADE_COST = 3;

export const MATERIAL_NAMES: Readonly<Record<GemTier, string>> = {
  1: 'Shard',
  2: 'Core',
  3: 'Heart',
  4: 'Sigil',
};

export type Materials = Readonly<Record<GemTier, number>>;

export const NO_MATERIALS: Materials = { 1: 0, 2: 0, 3: 0, 4: 0 };

export function materialsHeld(materials: Materials): number {
  return GEM_TIERS.reduce((total, tier) => total + materials[tier], 0);
}

export function grantMaterial(materials: Materials, tier: GemTier): Materials {
  return { ...materials, [tier]: materials[tier] + 1 };
}

/** Spends one of a tier, or says it could not (CLAUDE.md §5.4). */
export function spendMaterial(
  materials: Materials,
  tier: GemTier,
): { readonly ok: true; readonly materials: Materials } | { readonly ok: false } {
  if (materials[tier] <= 0) return { ok: false };
  return { ok: true, materials: { ...materials, [tier]: materials[tier] - 1 } };
}

/**
 * What each tier upgrades into, stated rather than computed. `tier + 1` is a
 * number, not a GemTier, and casting it back would be exactly the kind of
 * assertion CLAUDE.md §3.1 bans — a table cannot be off by one at the top.
 */
const NEXT_TIER: Readonly<Record<GemTier, GemTier | null>> = { 1: 2, 2: 3, 3: 4, 4: null };

/** Whether three of this tier are in hand and there is a tier above it. */
export function canUpgrade(materials: Materials, tier: GemTier): boolean {
  return NEXT_TIER[tier] !== null && materials[tier] >= UPGRADE_COST;
}

/**
 * Three of a tier become one of the next. Deliberately not automatic: three
 * Shards are a Core *or* three crafts, and which one you want is the question
 * the ladder exists to ask.
 */
export function upgradeMaterial(materials: Materials, tier: GemTier): Materials {
  const next = NEXT_TIER[tier];
  if (next === null || !canUpgrade(materials, tier)) return materials;

  return { ...materials, [tier]: materials[tier] - UPGRADE_COST, [next]: materials[next] + 1 };
}
