import Phaser from 'phaser';
import { DEPTH_COUNT } from '../run/map.ts';
import { RunSummaryView } from '../ui/RunSummaryView.ts';
import { runSceneData, type RunSceneData } from './sceneData.ts';
import { COLORS } from '../ui/theme.ts';

/**
 * The run's end (GDD §13).
 *
 * > Run summary: depth reached, build snapshot (cards + sockets + gems), Weave
 * > state, riddles completed, seed.
 * > **[NEW] Seed replay:** the summary offers "Retry this seed." Free, no reward
 * > penalty. This is how players learn that a loss was a decision and not a
 * > dice roll — an important trust mechanism in a game with this much
 * > randomness.
 *
 * That last sentence is why this screen exists at all rather than a fade back
 * to the first node: a roguelite that cannot show you the loss was yours does
 * not get the benefit of its own randomness.
 */
export class SummaryScene extends Phaser.Scene {
  private payload: RunSceneData | null = null;
  private view: RunSummaryView | null = null;

  constructor() {
    super('Summary');
  }

  init(data: unknown): void {
    this.payload = runSceneData(data, 'SummaryScene');
  }

  create(): void {
    const data = this.payload;
    if (data === null) return;

    this.cameras.main.setBackgroundColor(COLORS.background);
    this.view = new RunSummaryView({
      scene: this,
      onRetrySeed: () => {
        data.dispatch({ kind: 'retrySeed' });
      },
      onNewRun: () => {
        // A scene may read a clock; §20.2's rule is about /sim and /run, which
        // must stay replayable. A new seed is the one place a run legitimately
        // starts from something outside itself.
        data.dispatch({ kind: 'newRun', seed: Date.now() });
      },
    });

    if (data.view.kind === 'summary') {
      this.view.render({ run: data.run, won: data.view.won, depths: DEPTH_COUNT });
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.view?.destroy();
      this.view = null;
    });
  }
}
