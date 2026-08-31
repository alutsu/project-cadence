import type { RunIntent, RunView } from '../run/runFlow.ts';
import type { RunState } from '../run/RunState.ts';

/**
 * What `RunScene` hands a child scene.
 *
 * Phaser passes scene data through as loosely-typed `object | undefined`, so it
 * arrives unvalidated and has to be narrowed rather than asserted
 * (CLAUDE.md §3.3). The guard below is that narrowing, and it is the only place
 * a scene payload is trusted.
 *
 * `dispatch` is a function, which is why this is passed rather than serialized:
 * a child scene never changes the run itself. It says what the player did, and
 * `RunScene` — which owns the one `RunState` — decides what that means.
 */
export interface RunSceneData<V extends RunView = RunView> {
  readonly view: V;
  readonly run: RunState;
  readonly dispatch: (intent: RunIntent) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isRunSceneData(value: unknown): value is RunSceneData {
  if (!isRecord(value)) return false;

  return (
    isRecord(value.view) &&
    typeof value.view.kind === 'string' &&
    isRecord(value.run) &&
    typeof value.dispatch === 'function'
  );
}

/** Fails loudly rather than rendering an empty screen (CLAUDE.md §5.4). */
export function runSceneData(value: unknown, scene: string): RunSceneData {
  if (!isRunSceneData(value)) {
    throw new Error(`${scene} was started without a run view`);
  }
  return value;
}
