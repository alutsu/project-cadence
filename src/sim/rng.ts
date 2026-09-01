/**
 * Seeded, counter-based PRNG (GDD §20.2). One run seed feeds several named
 * streams, so consuming randomness in one system never reshuffles another —
 * which is what makes a system testable in isolation and a seed replayable.
 *
 * Counter-based rather than state-chaining so restoring a saved position is O(1)
 * (GDD §16: stream positions are part of the save).
 */
export type RngStreamName = (typeof RNG_STREAM_NAMES)[number];

/**
 * Every stream, once.
 *
 * The union and the list used to be written out separately in three places, and
 * adding `reward` proved why that is a hazard: two of the three were updated and
 * the save layer then rejected the stream it had just been handed. Deriving the
 * union from the list makes a half-added stream a compile error rather than a
 * runtime refusal.
 *
 * Order is part of the contract — `freshStreams` walks it — so append, never
 * insert.
 */
export const RNG_STREAM_NAMES = [
  'map',
  'gemRoll',
  'enemyGen',
  'combat',
  'weave',
  'reward',
] as const;

export interface RngState {
  readonly stream: RngStreamName;
  readonly seed: number;
  readonly position: number;
}

export interface Rng {
  /** Uniform in [0, 1). */
  nextFloat(): number;
  /** Uniform integer in [0, boundExclusive). */
  nextInt(boundExclusive: number): number;
  /** Serializable position, for saves and run summaries. */
  state(): RngState;
}

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

function streamBase(seed: number, stream: RngStreamName): number {
  let hash = FNV_OFFSET ^ (seed | 0);
  for (const character of stream) {
    hash = Math.imul(hash ^ character.charCodeAt(0), FNV_PRIME);
  }
  return hash >>> 0;
}

function splitmix32(input: number): number {
  let z = (input + 0x9e3779b9) | 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  return (z ^ (z >>> 15)) >>> 0;
}

const UINT32_RANGE = 0x1_0000_0000;

function rngFrom(state: RngState): Rng {
  const base = streamBase(state.seed, state.stream);
  let position = state.position;

  const nextFloat = (): number => {
    const value = splitmix32((base + position) | 0);
    position += 1;
    return value / UINT32_RANGE;
  };

  return {
    nextFloat,
    nextInt(boundExclusive: number): number {
      if (!Number.isInteger(boundExclusive) || boundExclusive <= 0) {
        throw new RangeError(
          `nextInt bound must be a positive integer, received ${String(boundExclusive)}`,
        );
      }
      return Math.floor(nextFloat() * boundExclusive);
    },
    state(): RngState {
      return { stream: state.stream, seed: state.seed, position };
    },
  };
}

export function createRng(seed: number, stream: RngStreamName): Rng {
  return rngFrom({ seed, stream, position: 0 });
}

/** Resumes a stream exactly where a save left it (GDD §16, §20.2). */
export function restoreRng(state: RngState): Rng {
  if (!Number.isInteger(state.position) || state.position < 0) {
    throw new RangeError(
      `Rng position must be a non-negative integer, received ${String(state.position)}`,
    );
  }
  return rngFrom(state);
}
