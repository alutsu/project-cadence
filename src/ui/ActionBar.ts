import Phaser from 'phaser';
import { playerActor, type CombatState } from '../sim/state.ts';
import { COLORS, FONT, INK, LAYOUT, MUTED, PLAYER_INK, TYPE } from './theme.ts';

export interface ActionBarOptions {
  readonly scene: Phaser.Scene;
  readonly onWait: () => void;
}

const WAIT_LABEL = 'WAIT  W3';

/**
 * The player's own readouts. There is no avatar to hang them on (GDD §15.1), so
 * HP and the clock sit at the edges of the frame, and Wait — which the player
 * may always take (GDD §4.3) — is a button that is never disabled.
 */
export class ActionBar {
  private readonly hp: Phaser.GameObjects.Text;
  private readonly clock: Phaser.GameObjects.Text;
  private readonly button: Phaser.GameObjects.Rectangle;
  private readonly buttonLabel: Phaser.GameObjects.Text;

  constructor(options: ActionBarOptions) {
    const { scene, onWait } = options;
    const { margin } = LAYOUT.hud;
    const bottom = LAYOUT.height - margin;

    this.hp = scene.add
      .text(margin, bottom, '', { fontFamily: FONT, fontSize: TYPE.hud, color: PLAYER_INK })
      .setOrigin(0, 1);

    this.clock = scene.add
      .text(margin, LAYOUT.hud.margin, '', { fontFamily: FONT, fontSize: TYPE.hud, color: MUTED })
      .setOrigin(0, 0);

    this.button = scene.add.rectangle(
      LAYOUT.width - margin - 90,
      bottom - 26,
      180,
      64,
      COLORS.panel,
    );
    this.button.setStrokeStyle(2, COLORS.player);
    this.button.setInteractive({ useHandCursor: true });
    this.button.on('pointerover', () => {
      this.button.setFillStyle(COLORS.panelActive);
    });
    this.button.on('pointerout', () => {
      this.button.setFillStyle(COLORS.panel);
    });
    this.button.on('pointerdown', onWait);

    this.buttonLabel = scene.add
      .text(this.button.x, this.button.y, WAIT_LABEL, {
        fontFamily: FONT,
        fontSize: TYPE.button,
        color: INK,
      })
      .setOrigin(0.5, 0.5);
  }

  render(state: CombatState): void {
    const player = playerActor(state);
    this.hp.setText(
      player === undefined ? '' : `HP ${String(player.hp)} / ${String(player.maxHp)}`,
    );
    this.clock.setText(`tick ${String(state.now)}   ${outcomeCaption(state)}`);
  }

  destroy(): void {
    this.button.removeAllListeners();
    this.button.destroy();
    this.buttonLabel.destroy();
    this.hp.destroy();
    this.clock.destroy();
  }
}

function outcomeCaption(state: CombatState): string {
  switch (state.outcome) {
    case 'ongoing':
      return state.activeActorId === null ? 'resolving' : 'your move';
    case 'won':
      return 'encounter won';
    case 'lost':
      return 'you died';
  }
}
