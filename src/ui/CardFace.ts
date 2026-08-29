import Phaser from 'phaser';
import type { CardDefinition } from '../sim/card.ts';
import { COLORS, FONT, INK, LAYOUT, MUTED, PLAYER_INK, TYPE } from './theme.ts';

export interface CardFaceOptions {
  readonly scene: Phaser.Scene;
  readonly card: CardDefinition;
  readonly onPlay: (card: CardDefinition) => void;
  readonly onHover: (card: CardDefinition | null) => void;
}

interface StatColumn {
  readonly label: string;
  readonly value: string;
  readonly offset: number;
  readonly emphasis: boolean;
}

/**
 * One card, drawn as if held (GDD §15.1). Weight and Recovery are rendered at
 * the same size as damage, because §15 makes that a rule: if the player has to
 * hunt for Weight, pillar P1 has already failed.
 */
export class CardFace {
  readonly view: Phaser.GameObjects.Container;
  private readonly panel: Phaser.GameObjects.Rectangle;

  constructor(options: CardFaceOptions) {
    const { scene, card, onPlay, onHover } = options;
    const { cardWidth, cardHeight } = LAYOUT.hand;

    this.view = scene.add.container(0, 0);
    this.panel = scene.add.rectangle(0, 0, cardWidth, cardHeight, COLORS.panel);
    this.panel.setStrokeStyle(2, COLORS.panelEdge);
    this.panel.setInteractive({ useHandCursor: true });
    this.view.add(this.panel);

    this.view.add(
      scene.add
        .text(0, -cardHeight / 2 + 26, card.name, {
          fontFamily: FONT,
          fontSize: TYPE.cardName,
          color: INK,
        })
        .setOrigin(0.5, 0.5),
    );

    this.view.add(
      scene.add
        .text(0, -cardHeight / 2 + 54, card.weightClass.toUpperCase(), {
          fontFamily: FONT,
          fontSize: TYPE.cardStatLabel,
          color: MUTED,
        })
        .setOrigin(0.5, 0.5),
    );

    for (const column of statColumns(card)) {
      this.view.add(
        scene.add
          .text(column.offset, cardHeight / 2 - 84, column.label, {
            fontFamily: FONT,
            fontSize: TYPE.cardStatLabel,
            color: MUTED,
          })
          .setOrigin(0.5, 0.5),
      );
      this.view.add(
        scene.add
          .text(column.offset, cardHeight / 2 - 50, column.value, {
            fontFamily: FONT,
            fontSize: TYPE.cardStat,
            color: column.emphasis ? PLAYER_INK : INK,
          })
          .setOrigin(0.5, 0.5),
      );
    }

    this.panel.on('pointerover', () => {
      this.panel.setFillStyle(COLORS.panelActive);
      onHover(card);
    });
    this.panel.on('pointerout', () => {
      this.panel.setFillStyle(COLORS.panel);
      onHover(null);
    });
    this.panel.on('pointerdown', () => {
      onPlay(card);
    });
  }

  destroy(): void {
    this.panel.removeAllListeners();
    this.view.destroy(true);
  }
}

function statColumns(card: CardDefinition): readonly StatColumn[] {
  // Kept well inside the card edge: the hand is tilted, so neighbouring cards
  // overlap at the corners and anything near an edge gets painted over.
  const spread = Math.round(LAYOUT.hand.cardWidth / 3.6);
  return [
    { label: 'WGT', value: String(card.weight), offset: -spread, emphasis: true },
    { label: 'DMG', value: String(card.damage), offset: 0, emphasis: false },
    { label: 'REC', value: String(card.recovery), offset: spread, emphasis: false },
  ];
}
