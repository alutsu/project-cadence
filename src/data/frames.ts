import { isFrame, type Frame, type GemTier } from '../sim/gem.ts';
import { isRegisteredEffect } from '../sim/gemEffects.ts';
import '../sim/standardEffects.ts';
import type { ParseResult } from './cards.ts';
import frameData from './frames.json' with { type: 'json' };

/**
 * The frame recipes (GDD §6.2, docs/M1_PLAN.md D33).
 *
 * A frame names which effect atoms it rolls and the range each rolls in, per
 * tier. It is data because the atoms are the code: a frame built from atoms
 * that already exist costs no code at all (CLAUDE.md §4.2).
 *
 * Importing this module registers the standard atoms, so validating the table
 * is what proves every atom it names exists.
 */

/** Inclusive [low, high]. A tier that rolls a fixed value has low === high. */
export interface RollRange {
  readonly low: number;
  readonly high: number;
}

export interface FrameRoll {
  readonly type: string;
  /** One range per tier, indexed 0..3 for tiers 1..4 (GDD §6.2). */
  readonly tiers: readonly RollRange[];
}

export interface FrameRecipe {
  readonly id: Frame;
  readonly effect: string;
  readonly drawback: string;
  readonly rolls: readonly FrameRoll[];
}

export type FrameTable = Readonly<Record<string, FrameRecipe>>;

const TIER_COUNT = 4;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  // `Array.isArray` narrows to `any[]`, which would smuggle `any` into every
  // element read past it (CLAUDE.md §3.1). This narrows to `unknown[]` instead,
  // so each element still has to be checked before it is used.
  return Array.isArray(value);
}

function readRange(value: unknown): RollRange | string {
  if (!isUnknownArray(value) || value.length !== 2) return 'is not a [low, high] pair';

  const [low, high] = value;
  if (
    typeof low !== 'number' ||
    typeof high !== 'number' ||
    !Number.isFinite(low) ||
    !Number.isFinite(high)
  ) {
    return 'has a non-numeric bound';
  }
  if (low > high) return `has low ${String(low)} above high ${String(high)}`;

  return { low, high };
}

function readRoll(value: unknown, frame: string): FrameRoll | string {
  if (!isRecord(value)) return `frame "${frame}" has a roll that is not an object`;

  const { type, tiers } = value;
  if (typeof type !== 'string' || type.length === 0)
    return `frame "${frame}" has a roll with no type`;
  // The atom is the contract (CLAUDE.md §4.2): a frame naming one that nobody
  // registered is a recipe for something the game cannot do, and it must fail
  // at load rather than silently contribute nothing mid-encounter.
  if (!isRegisteredEffect(type)) return `frame "${frame}" rolls unregistered effect "${type}"`;
  if (!Array.isArray(tiers) || tiers.length !== TIER_COUNT) {
    return `frame "${frame}" roll "${type}" needs ${String(TIER_COUNT)} tiers`;
  }

  const ranges: RollRange[] = [];
  for (const [index, entry] of tiers.entries()) {
    const range = readRange(entry);
    if (typeof range === 'string') {
      return `frame "${frame}" roll "${type}" tier ${String(index + 1)} ${range}`;
    }
    ranges.push(range);
  }

  return { type, tiers: ranges };
}

function readFrame(value: unknown, position: number): FrameRecipe | string {
  if (!isRecord(value)) return `frame ${String(position)} is not an object`;

  const { id, effect, drawback, rolls } = value;
  if (!isFrame(id)) return `frame ${String(position)} has an unknown id: ${JSON.stringify(id)}`;
  if (typeof effect !== 'string' || effect.length === 0) return `frame "${id}" states no effect`;
  // GDD §6.2 and §10: every frame carries a real drawback. A frame without one
  // is a pure upgrade, and a pure upgrade is a known-correct answer — the meta
  // this design exists to avoid (§23). The table is not allowed to omit it.
  if (typeof drawback !== 'string' || drawback.length === 0)
    return `frame "${id}" states no drawback`;
  if (!Array.isArray(rolls) || rolls.length === 0) return `frame "${id}" rolls nothing`;

  const read = rolls.map((entry) => readRoll(entry, id));
  const failure = read.find((entry): entry is string => typeof entry === 'string');
  if (failure !== undefined) return failure;

  return {
    id,
    effect,
    drawback,
    rolls: read.filter((entry): entry is FrameRoll => typeof entry !== 'string'),
  };
}

export function parseFrameTable(input: unknown): ParseResult<FrameTable> {
  if (!isRecord(input) || !Array.isArray(input.frames)) {
    return { ok: false, errors: ['frame data has no "frames" array'] };
  }

  const read = input.frames.map((entry, position) => readFrame(entry, position));
  const errors = read.filter((entry): entry is string => typeof entry === 'string');
  if (errors.length > 0) return { ok: false, errors };

  const frames = read.filter((entry): entry is FrameRecipe => typeof entry !== 'string');
  const duplicates = frames
    .map((frame) => frame.id)
    .filter((id, at, all) => all.indexOf(id) !== at);
  if (duplicates.length > 0)
    return { ok: false, errors: [`duplicate frames: ${duplicates.join(', ')}`] };

  const table: Record<string, FrameRecipe> = {};
  for (const frame of frames) table[frame.id] = frame;
  return { ok: true, value: table };
}

/** The frame table, validated. Throws loudly rather than booting with bad data. */
export function frameTable(): FrameTable {
  const parsed = parseFrameTable(frameData);
  if (!parsed.ok) throw new Error(`frames.json is invalid:\n- ${parsed.errors.join('\n- ')}`);
  return parsed.value;
}

/** The range a frame's atom rolls in at this tier (GDD §6.2). */
export function rangeAt(roll: FrameRoll, tier: GemTier): RollRange {
  const range = roll.tiers[tier - 1];
  if (range === undefined) throw new RangeError(`roll "${roll.type}" has no tier ${String(tier)}`);
  return range;
}
