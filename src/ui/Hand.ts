import Phaser from 'phaser';
import type { CardDefinition } from '../sim/card.ts';
import { findCard } from '../sim/card.ts';
import type { CombatState } from '../sim/state.ts';
import { CardFace } from './CardFace.ts';
import { LAYOUT } from './theme.ts';

export interface HandOptions {
  readonly scene: Phaser.Scene;
  readonly onPlay: (card: CardDefinition) => void;
  readonly onHover: (card: CardDefinition | null) => void;
}

/**
 * The hand, held in the player's own hands along the bottom of the frame
 * (GDD §15.1). The tilt and lift are the whole "first person" trick — cards fan
 * from a point below the screen, as if looked down at.
 */
export class Hand {
  private readonly options: HandOptions;
  private faces: CardFace[] = [];

  constructor(options: HandOptions) {
    this.options = options;
  }

  render(state: CombatState): void {
    this.clear();

    const cards = state.hand
      .map((id) => findCard(state.catalogue, id))
      .filter((card): card is CardDefinition => card !== undefined);

    const { cardWidth, gap, baselineY, tiltDegrees, lift } = LAYOUT.hand;
    const step = cardWidth + gap;
    const middle = (cards.length - 1) / 2;

    this.faces = cards.map((card, index) => {
      const face = new CardFace({
        scene: this.options.scene,
        card,
        onPlay: this.options.onPlay,
        onHover: this.options.onHover,
      });
      const fromCenter = index - middle;
      face.view.setPosition(
        LAYOUT.width / 2 + fromCenter * step,
        baselineY + Math.abs(fromCenter) * lift,
      );
      face.view.setAngle(fromCenter * tiltDegrees);
      return face;
    });
  }

  destroy(): void {
    this.clear();
  }

  private clear(): void {
    for (const face of this.faces) face.destroy();
    this.faces = [];
  }
}
