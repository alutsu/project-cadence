import Phaser from 'phaser';
import { maxHpFloor, type RunState } from '../run/RunState.ts';
import { MATERIAL_NAMES } from '../run/materials.ts';
import { GEM_TIERS } from '../sim/gem.ts';
import { COLORS, FONT, GUARD_INK, LAYOUT, MUTED, PLAYER_INK, TYPE } from './theme.ts';

/**
 * The Sanctum, drawn (GDD §11).
 *
 * Two acts and a door. §11 says the Sanctum is "free, but it costs the node",
 * so the screen's job is to make what it costs legible: resting fills the pool
 * you have — never raises it, because a Sanctum that restored Max HP would
 * refund the one price §6.1 charges — and forging spends from a purse that is
 * printed right beside the button.
 */

export interface SanctumOptions {
  readonly scene: Phaser.Scene;
  readonly onRest: () => void;
  readonly onForge: () => void;
  readonly onLeave: () => void;
}

export class SanctumView {
  private readonly heading: Phaser.GameObjects.Text;
  private readonly purse: Phaser.GameObjects.Text;
  private readonly buttons: Phaser.GameObjects.Container;
  private readonly options: SanctumOptions;

  constructor(options: SanctumOptions) {
    this.options = options;
    const { scene } = options;

    this.heading = scene.add
      .text(LAYOUT.width / 2, 220, 'THE SANCTUM', {
        fontFamily: FONT,
        fontSize: TYPE.button,
        color: GUARD_INK,
      })
      .setOrigin(0.5, 0.5);
    this.purse = scene.add
      .text(LAYOUT.width / 2, 330, '', {
        fontFamily: FONT,
        fontSize: TYPE.slotName,
        color: MUTED,
        align: 'center',
        lineSpacing: 10,
      })
      .setOrigin(0.5, 0);
    this.buttons = scene.add.container(0, 0);
  }

  render(run: RunState): void {
    const whole = run.hp >= run.maxHp;
    this.purse.setText(
      [
        `${String(run.hp)}/${String(run.maxHp)} HP   ·   Max HP floor ${String(maxHpFloor(run))}`,
        `${GEM_TIERS.map((tier) => `${MATERIAL_NAMES[tier]} ${String(run.materials[tier])}`).join('   ')}   ·   Insight ${String(run.insight)}`,
        '',
        'resting fills the pool you have — it never raises it (§6.1)',
      ].join('\n'),
    );

    this.buttons.removeAll(true);
    this.button(
      whole ? 'ALREADY WHOLE' : `REST — HEAL ${String(run.maxHp - run.hp)}`,
      LAYOUT.width / 2 - 360,
      whole ? null : this.options.onRest,
    );
    this.button('THE FORGE  (F)', LAYOUT.width / 2, this.options.onForge);
    this.button('MOVE ON', LAYOUT.width / 2 + 360, this.options.onLeave);
  }

  destroy(): void {
    this.heading.destroy();
    this.purse.destroy();
    this.buttons.destroy(true);
  }

  /** A null handler renders the act as unavailable rather than hiding it. */
  private button(label: string, x: number, onPress: (() => void) | null): void {
    const { scene } = this.options;
    const panel = scene.add
      .rectangle(x, LAYOUT.height - 260, 330, 90, COLORS.panel)
      .setStrokeStyle(2, onPress === null ? COLORS.panelEdge : COLORS.guard);

    if (onPress !== null) {
      panel.setInteractive({ useHandCursor: true });
      panel.on('pointerdown', onPress);
    }

    const text = scene.add
      .text(x, LAYOUT.height - 260, label, {
        fontFamily: FONT,
        fontSize: TYPE.slotName,
        color: onPress === null ? MUTED : PLAYER_INK,
        align: 'center',
        wordWrap: { width: 300 },
      })
      .setOrigin(0.5, 0.5);

    this.buttons.add([panel, text]);
  }
}
