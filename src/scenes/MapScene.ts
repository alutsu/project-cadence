import Phaser from 'phaser';
import { levelOf } from '../run/runFlow.ts';
import { MapView } from '../ui/MapView.ts';
import { runSceneData, type RunSceneData } from './sceneData.ts';
import { COLORS } from '../ui/theme.ts';

/**
 * The map screen (GDD §11).
 *
 * Wiring only (CLAUDE.md §6): it builds the view, hands it what the run offers,
 * and turns a click into an intent. It owns no game number and decides nothing
 * — which node is worth taking is the player's question, and until this scene
 * existed a stand-in answered it by always taking the first one on offer.
 */
export class MapScene extends Phaser.Scene {
  private payload: RunSceneData | null = null;
  private view: MapView | null = null;

  constructor() {
    super('Map');
  }

  init(data: unknown): void {
    this.payload = runSceneData(data, 'MapScene');
  }

  create(): void {
    const data = this.payload;
    if (data === null) return;

    this.cameras.main.setBackgroundColor(COLORS.background);
    this.view = new MapView({
      scene: this,
      onEnter: (node) => {
        data.dispatch({ kind: 'enterNode', node });
      },
    });

    this.render();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.view?.destroy();
      this.view = null;
    });
  }

  private render(): void {
    const data = this.payload;
    if (data === null || this.view === null) return;
    if (data.view.kind !== 'map') return;

    this.view.render({
      run: data.run,
      depth: data.view.depth,
      // Each node's enemy level, worked out by the run rather than the view:
      // §11 shows a Threat rating before you commit, and the view is not
      // allowed to compute what it means (CLAUDE.md §2.1).
      offered: data.view.offered.map((node) => ({ node, level: levelOf(data.run, node) })),
    });
  }
}
