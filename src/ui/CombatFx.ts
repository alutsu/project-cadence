import Phaser from 'phaser';
import { COLORS, ENEMY_INK, FONT, FX, INK, LAYOUT, PLAYER_INK, TYPE } from './theme.ts';

export interface StrikeSpec {
  readonly from: { readonly x: number; readonly y: number };
  readonly to: { readonly x: number; readonly y: number };
  readonly name: string;
}

export interface ImpactSpec {
  readonly at: { readonly x: number; readonly y: number };
  readonly amount: number;
  readonly lethal: boolean;
}

/**
 * The transient layer: things that appear, move once and are gone. It holds no
 * game state and reads none — the scene tells it what already happened.
 *
 * GDD §15 requires every animation to be skippable, which is only safe because
 * the sim has already resolved everything these tweens depict. Turning them off
 * (the `A` key) removes the delay and nothing else.
 */
export class CombatFx {
  private readonly layer: Phaser.GameObjects.Container;

  constructor(private readonly scene: Phaser.Scene) {
    this.layer = scene.add.container(0, 0);
  }

  /** The played card travels from its seat in the hand to what it hits. */
  strike(spec: StrikeSpec): void {
    const { cardWidth, cardHeight } = LAYOUT.hand;
    const ghost = this.scene.add.container(spec.from.x, spec.from.y);

    const panel = this.scene.add.rectangle(0, 0, cardWidth, cardHeight, COLORS.panelActive);
    panel.setStrokeStyle(2, COLORS.player);
    ghost.add(panel);
    ghost.add(
      this.scene.add
        .text(0, 0, spec.name, { fontFamily: FONT, fontSize: TYPE.cardName, color: PLAYER_INK })
        .setOrigin(0.5, 0.5),
    );

    this.layer.add(ghost);
    this.scene.tweens.add({
      targets: ghost,
      x: spec.to.x,
      y: spec.to.y,
      scale: 0.35,
      alpha: 0,
      duration: FX.throwMs,
      ease: 'Quad.easeIn',
      onComplete: () => {
        ghost.destroy(true);
      },
    });
  }

  /** Where the blow landed, and what it was worth. */
  impact(spec: ImpactSpec): void {
    this.ring(spec);
    this.figure(spec);
  }

  destroy(): void {
    this.layer.destroy(true);
  }

  private ring(spec: ImpactSpec): void {
    const { width, height } = LAYOUT.enemies;
    const ring = this.scene.add.rectangle(spec.at.x, spec.at.y, width, height);
    ring.setStrokeStyle(3, spec.lethal ? COLORS.danger : COLORS.enemy);

    this.layer.add(ring);
    this.scene.tweens.add({
      targets: ring,
      scale: FX.ringScale,
      alpha: 0,
      duration: FX.ringMs,
      ease: 'Quad.easeOut',
      onComplete: () => {
        ring.destroy();
      },
    });
  }

  private figure(spec: ImpactSpec): void {
    const figure = this.scene.add
      .text(spec.at.x, spec.at.y, String(spec.amount), {
        fontFamily: FONT,
        fontSize: TYPE.cardStat,
        color: spec.lethal ? INK : ENEMY_INK,
      })
      .setOrigin(0.5, 0.5);

    this.layer.add(figure);
    this.scene.tweens.add({
      targets: figure,
      y: figure.y - FX.risePixels,
      alpha: 0,
      duration: FX.riseMs,
      ease: 'Quad.easeOut',
      onComplete: () => {
        figure.destroy();
      },
    });
  }
}
