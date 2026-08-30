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
  private idleNote: string | null = null;

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

  /**
   * A line to stand in place of the hover hint until the player acts. Used for
   * the opening exchange, which happens before they can do anything about it.
   */
  setIdleNote(note: string | null): void {
    this.idleNote = note;
  }

  render(label: string, preview: ActionPreview | null): void {
    if (preview === null) {
      const note = this.idleNote;
      this.headline.setText(note ?? IDLE_HINT).setColor(note === null ? MUTED : ENEMY_INK);
      this.detail.setText('');
      return;
    }

    this.headline.setText(`${label} — ${landingOf(preview)}`).setColor(PLAYER_INK);
    const dealt = preview.hits.reduce((total, hit) => total + hit.amount, 0);
    const parts = [
      `${String(preview.enemyTurnsBeforePlayer)} enemy ${plural(preview.enemyTurnsBeforePlayer)} first`,
      `${String(preview.incomingDamage)} incoming`,
      `${String(dealt)} dealt`,
    ];
    for (const stagger of preview.staggers) {
      parts.push(`STAGGER +${String(stagger.delay)}`);
    }

    this.detail
      .setText(parts.join('   ·   '))
      .setColor(staggerInk(preview.staggers.length, preview.incomingDamage));
  }

  /** Nothing to hover once the fight is over. */
  hide(): void {
    this.headline.setText('');
    this.detail.setText('');
  }

  destroy(): void {
    this.headline.destroy();
    this.detail.destroy();
  }
}

/**
 * A lethal card ends the fight on the player's own turn, so the tick it would
 * put them on never arrives. Saying "you act at t48" there is a lie the queue
 * cannot afford (P3) — the fight is what the player is choosing about.
 */
function landingOf(preview: ActionPreview): string {
  if (preview.outcome !== 'ongoing') return 'the encounter ends';
  if (preview.playerNextTick === null) return 'the encounter ends';
  return `you act at t${String(preview.playerNextTick)}`;
}

function plural(turns: number): string {
  return turns === 1 ? 'turn' : 'turns';
}

/** A Stagger is the payoff moment, so it wins the line's colour (GDD §4.6). */
function staggerInk(staggers: number, incoming: number): string {
  if (staggers > 0) return PLAYER_INK;
  return incoming > 0 ? ENEMY_INK : MUTED;
}
