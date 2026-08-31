import Phaser from 'phaser';
import type { CardDefinition } from '../sim/card.ts';
import {
  COLORS,
  ENEMY_INK,
  FONT,
  GUARD_INK,
  INK,
  LAYOUT,
  MUTED,
  PLAYER_INK,
  TYPE,
} from './theme.ts';

export interface CardFaceOptions {
  readonly scene: Phaser.Scene;
  readonly card: CardDefinition;
  /**
   * Ticks this card costs the player right now, from the sim. Equal to Weight
   * at Speed 100 and different under Slow or Haste — the card face is where
   * that gap has to be visible, because it is the thing being chosen.
   */
  readonly delay: number;
  /**
   * What this card would deal to one enemy right now, from the sim. Not the
   * printed number: the Weave moves it per target (GDD §7.2), and §15 says the
   * player never does that multiplication — so neither does this view.
   */
  readonly damage: number;
  /**
   * The card's Weight *as it stands*, from the sim. §7.1's Attunement moves it
   * by a tick and a gem moves it further, so the printed class value stops
   * being the answer — and Weight is the one number GDD §15 says the player
   * must never have to hunt for.
   */
  readonly weight: number;
  /** Likewise Recovery: HASTE and ECHO both move it (GDD §6.2). */
  readonly recovery: number;
  /** The card's sockets, and what is in them (GDD §6.1, §6.2). */
  readonly sockets: SocketMarks;
  readonly onPlay: (card: CardDefinition) => void;
  readonly onHover: (card: CardDefinition | null) => void;
}

/**
 * What the card's sockets look like, worked out by the sim side and handed over
 * as marks. §15.2 forbids encoding meaning in colour alone, so a filled socket
 * carries its frame's initial rather than merely being a different shade —
 * "this card has a REPEAT in it" is a mechanical fact the player reads.
 */
export interface SocketMarks {
  readonly opened: number;
  /** One entry per filled socket, in socket order. Order is meaning (§6.2). */
  readonly filled: readonly string[];
  readonly scarred: boolean;
}

export const NO_SOCKET_MARKS: SocketMarks = { opened: 0, filled: [], scarred: false };

/** GDD §6.1: an empty socket, a filled one, and a card that failed an attempt. */
export function socketLine(marks: SocketMarks): string {
  if (marks.opened === 0 && !marks.scarred) return '';

  const pips = Array.from({ length: marks.opened }, (_, at) => marks.filled[at] ?? '○').join(' ');
  return marks.scarred ? `${pips}  ✕ scarred` : pips;
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
    const { scene, card, delay, onPlay, onHover } = options;
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

    // Drawn only on the cards that have it, so the reach reads as the exception
    // it is (P5) — and on its own line, because appending it to the class label
    // ran it off both edges of the card.
    if (card.targeting === 'all') {
      this.view.add(
        scene.add
          .text(0, -cardHeight / 2 + 78, 'HITS ALL ENEMIES', {
            fontFamily: FONT,
            fontSize: TYPE.cardStatLabel,
            color: PLAYER_INK,
          })
          .setOrigin(0.5, 0.5),
      );
    }

    const sockets = socketLine(options.sockets);
    if (sockets.length > 0) {
      this.view.add(
        scene.add
          .text(0, -cardHeight / 2 + 100, sockets, {
            fontFamily: FONT,
            fontSize: TYPE.cardStatLabel,
            color: options.sockets.scarred ? ENEMY_INK : GUARD_INK,
          })
          .setOrigin(0.5, 0.5),
      );
    }

    for (const column of statColumns(options)) {
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

    // Only drawn when Weight and its cost have come apart, so the card stays
    // clean at Speed 100 and the tax is unmissable when there is one (P5).
    if (delay !== card.weight) {
      const heavier = delay > card.weight;
      this.view.add(
        scene.add
          .text(
            0,
            cardHeight / 2 - 16,
            `${heavier ? 'COSTS' : 'ONLY'} ${String(delay)} TICKS NOW`,
            {
              fontFamily: FONT,
              fontSize: TYPE.cardStatLabel,
              color: heavier ? ENEMY_INK : GUARD_INK,
            },
          )
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

function statColumns(spec: CardFaceOptions): readonly StatColumn[] {
  // Kept well inside the card edge: the hand is tilted, so neighbouring cards
  // overlap at the corners and anything near an edge gets painted over.
  const spread = Math.round(LAYOUT.hand.cardWidth / 3.6);
  return [
    { label: 'WGT', value: String(spec.weight), offset: -spread, emphasis: true },
    // Neither an AoE's printed damage nor a resisted card's is what an enemy
    // actually takes, so the figure shown is the one the sim will deal to each
    // of them (GDD §4.8, §7.2, P3). The label stays "DMG": a wider one broke
    // the three-column alignment §15 relies on.
    { label: 'DMG', value: String(spec.damage), offset: 0, emphasis: false },
    { label: 'REC', value: String(spec.recovery), offset: spread, emphasis: false },
  ];
}
