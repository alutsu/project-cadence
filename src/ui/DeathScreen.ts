import Phaser from 'phaser';
import { COLORS, FONT, INK, LAYOUT, MUTED, PLAYER_INK, TYPE } from './theme.ts';

/** Lines the screen is handed, already formatted — it renders, it never counts. */
export interface DeathReport {
  /** What killed the player, in words. */
  readonly cause: string;
  /** How far they got. */
  readonly reached: string;
  /** How they played, one line. */
  readonly played: string;
  /** Cards the deck offered and they never used. */
  readonly unplayed: string;
  /** The seed, so the run can be replayed exactly (GDD §13). */
  readonly seed: string;
}

/** Nearly opaque: at 0.88 the enemy panel still read through the headline. */
const DIM_ALPHA = 0.97;
const HEADLINE_Y = 380;

/**
 * The run-end summary (GDD §13), reduced to what M0 actually has: no build
 * snapshot, no Weave, no riddles, no currencies — a depth, a cause, and a seed.
 *
 * The seed line is the point. GDD §13 calls seed replay a trust mechanism: it
 * is how a player learns that a loss was a decision and not a dice roll, which
 * matters more here than anywhere, because M0's whole claim is that the queue
 * is readable in advance.
 */
export class DeathScreen {
  private readonly dim: Phaser.GameObjects.Rectangle;
  private readonly headline: Phaser.GameObjects.Text;
  private readonly cause: Phaser.GameObjects.Text;
  private readonly detail: Phaser.GameObjects.Text;
  private readonly prompt: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene) {
    const centre = LAYOUT.width / 2;

    this.dim = scene.add
      .rectangle(centre, LAYOUT.height / 2, LAYOUT.width, LAYOUT.height, COLORS.background)
      .setAlpha(DIM_ALPHA);

    this.headline = scene.add
      .text(centre, HEADLINE_Y, 'YOU DIED', {
        fontFamily: FONT,
        fontSize: TYPE.cardStat,
        color: INK,
      })
      .setOrigin(0.5, 0.5);

    this.cause = scene.add
      .text(centre, HEADLINE_Y + 70, '', {
        fontFamily: FONT,
        fontSize: TYPE.hud,
        color: PLAYER_INK,
        align: 'center',
      })
      .setOrigin(0.5, 0.5);

    this.detail = scene.add
      .text(centre, HEADLINE_Y + 170, '', {
        fontFamily: FONT,
        fontSize: TYPE.slotName,
        color: MUTED,
        align: 'center',
        lineSpacing: 12,
      })
      .setOrigin(0.5, 0.5);

    this.prompt = scene.add
      .text(centre, HEADLINE_Y + 340, 'click to retry this seed', {
        fontFamily: FONT,
        fontSize: TYPE.hud,
        color: PLAYER_INK,
      })
      .setOrigin(0.5, 0.5);

    this.hide();
  }

  show(report: DeathReport): void {
    this.cause.setText(report.cause);
    this.detail.setText([report.reached, report.played, report.unplayed, report.seed].join('\n'));
    for (const item of this.items()) item.setVisible(true);
  }

  hide(): void {
    for (const item of this.items()) item.setVisible(false);
  }

  destroy(): void {
    for (const item of this.items()) item.destroy();
  }

  private items(): readonly (Phaser.GameObjects.Rectangle | Phaser.GameObjects.Text)[] {
    return [this.dim, this.headline, this.cause, this.detail, this.prompt];
  }
}
