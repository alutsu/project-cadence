import Phaser from 'phaser';
import { playtestLog, type PlaytestLog } from '../platform/playtest.ts';
import { advanceRun, viewOf, type RunIntent, type RunView } from '../run/runFlow.ts';
import { levelOf } from '../run/runFlow.ts';
import { nodeRecord, runSummary } from '../run/telemetry.ts';
import { startRun, type RunState } from '../run/RunState.ts';
import type { CardId, NodeId } from '../sim/ids.ts';
import { isRefreshable, type RunSceneData } from './sceneData.ts';

/**
 * The run's owner (GDD §20.1's tree, CLAUDE.md §4.1).
 *
 * One `RunState` lives here and nowhere else. This scene reads `viewOf` to
 * decide which screen the run is on, starts that scene with the view and a
 * `dispatch`, and applies whatever comes back through `advanceRun`. It renders
 * nothing itself.
 *
 * The point of the arrangement is that **the flow is a reducer** and this is
 * only its wiring: the balance harness plays a whole run through the same
 * `advanceRun` a click here calls, so a number it prints describes the shipping
 * game rather than a parallel re-implementation of it.
 */
const SCENES: Readonly<Record<RunView['kind'], string>> = {
  map: 'Map',
  encounter: 'Combat',
  sanctum: 'Sanctum',
  market: 'Market',
  summary: 'Summary',
};

export class RunScene extends Phaser.Scene {
  private run: RunState;
  private readonly playtest: PlaytestLog;
  private readonly played = new Set<CardId>();
  private recordedNode: NodeId | null = null;
  private active: string | null = null;

  constructor(seed: number, session: string) {
    super('Run');
    this.run = startRun(seed);
    this.playtest = playtestLog(session);
    this.playtest.record({
      kind: 'run_started',
      seed,
      attunement: { ...this.run.attunement },
    });
  }

  create(): void {
    this.show();
  }

  /** Every card the player has played this run, for §19's "never played". */
  noteCardPlayed(card: CardId): void {
    this.played.add(card);
  }

  /** What a child scene calls. The child decides nothing; it reports. */
  dispatch(intent: RunIntent): void {
    // A market is not built yet (§9 is S5's), so entering one leaves again
    // rather than stranding the run on a screen that does not exist.
    const stepped = advanceRun(this.run, intent);
    this.run = stepped.run;

    if (intent.kind === 'retrySeed' || intent.kind === 'newRun') {
      this.played.clear();
      this.recordedNode = null;
      this.playtest.record({
        kind: 'run_started',
        seed: this.run.seed,
        attunement: { ...this.run.attunement },
      });
    }

    this.show();
  }

  /** The run as it stands, for a child scene that needs to read it. */
  state(): RunState {
    return this.run;
  }

  playedCards(): ReadonlySet<CardId> {
    return this.played;
  }

  private show(): void {
    const view = viewOf(this.run);

    this.record(view);

    const next = SCENES[view.kind];
    const data: RunSceneData = {
      view,
      run: this.run,
      dispatch: (intent) => {
        this.dispatch(intent);
      },
    };

    // A scene already showing this kind of view is *refreshed*, not restarted.
    // Restarting runs `init` again, which threw away everything the player had
    // set up on that screen — crafting a gem closed the forge behind it, and
    // the card they had picked went with it.
    if (this.active === next) {
      const showing: unknown = this.scene.get(next);
      if (isRefreshable(showing)) {
        showing.refresh(data);
        return;
      }
    }

    // A different screen, or one that cannot take a refresh: stop and relaunch.
    // A scene that kept its board across two different encounters would be a
    // scene holding game state, and CLAUDE.md §4.1 says it may not.
    if (this.active !== null) this.scene.stop(this.active);
    this.active = next;
    this.scene.launch(next, data);
  }

  private record(view: RunView): void {
    if (view.kind === 'summary') {
      this.playtest.record({
        kind: 'run_ended',
        summary: runSummary(this.run, view.won, this.played),
      });
      this.playtest.flush();
      return;
    }
    if (view.kind !== 'encounter' || view.node.id === this.recordedNode) return;

    this.recordedNode = view.node.id;
    this.playtest.record({
      kind: 'node_entered',
      node: nodeRecord(this.run, view.node, levelOf(this.run, view.node)),
    });
  }
}
