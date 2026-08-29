import Phaser from 'phaser';
import type { ActionPreview } from '../sim/forecast.ts';
import { ENEMY_INK, FONT, LAYOUT, MUTED, PLAYER_INK, TYPE } from './theme.ts';

const IDLE_HINT = 'hover a card to see where it puts you';

/**
 * The one line that answers "what does this cost me?" (GDD §15: the player
 * should never do multiplication in their head). Every number here is read off
 * the sim's preview — the readout formats, it never calculates.
 */
export class PreviewReadout {
  private readonly headline: Phaser.GameObjects.Text;
  private readonly detail: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene) {
    const y = LAYOUT.queue.top + LAYOUT.queue.slotHeight + 34;
    this.headline = scene.add
      .text(LAYOUT.width / 2, y, IDLE_HINT, {
        fontFamily: FONT,
        fontSize: TYPE.hud,
        color: MUTED,
      })
      .setOrigin(0.5, 0.5);
    this.detail = scene.add
      .text(LAYOUT.width / 2, y + 34, '', {
        fontFamily: FONT,
        fontSize: TYPE.slotName,
        color: MUTED,
      })
      .setOrigin(0.5, 0.5);
  }

  render(label: string, preview: ActionPreview | null): void {
    if (preview === null) {
      this.headline.setText(IDLE_HINT).setColor(MUTED);
      this.detail.setText('');
      return;
    }

    const landing =
      preview.playerNextTick === null
        ? 'the encounter ends'
        : `you act at t${String(preview.playerNextTick)}`;
    this.headline.setText(`${label} — ${landing}`).setColor(PLAYER_INK);

    const dealt = preview.hits.reduce((total, hit) => total + hit.amount, 0);
    this.detail
      .setText(
        [
          `${String(preview.enemyTurnsBeforePlayer)} enemy ${plural(preview.enemyTurnsBeforePlayer)} first`,
          `${String(preview.incomingDamage)} incoming`,
          `${String(dealt)} dealt`,
        ].join('   ·   '),
      )
      .setColor(preview.incomingDamage > 0 ? ENEMY_INK : MUTED);
  }

  destroy(): void {
    this.headline.destroy();
    this.detail.destroy();
  }
}

function plural(turns: number): string {
  return turns === 1 ? 'turn' : 'turns';
}
