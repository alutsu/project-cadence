import { tick, type Tick } from './tick.ts';

/**
 * GDD §4.1's Weight classes, in one place. A card declares its class and
 * inherits both numbers, so the published table cannot drift card by card.
 * Gems adjust Weight at runtime (GDD §6.2); they never rewrite this table.
 */
export type WeightClass = 'light' | 'standard' | 'heavy' | 'ultimate';

export interface WeightProfile {
  readonly weight: Tick;
  readonly recovery: Tick;
}

export const WEIGHT_CLASSES: Readonly<Record<WeightClass, WeightProfile>> = {
  light: { weight: tick(4), recovery: tick(8) },
  standard: { weight: tick(6), recovery: tick(14) },
  heavy: { weight: tick(10), recovery: tick(26) },
  ultimate: { weight: tick(16), recovery: tick(60) },
};

const CLASS_NAMES: readonly string[] = Object.keys(WEIGHT_CLASSES);

export function isWeightClass(value: unknown): value is WeightClass {
  return typeof value === 'string' && CLASS_NAMES.includes(value);
}
