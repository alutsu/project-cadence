import Phaser from 'phaser';
import { FONT, INK, LAYOUT, MUTED, PLAYER_INK, TYPE } from './theme.ts';

/**
 * Which fight this is and what it is for. Present because M0's whole purpose is
 * a feel test: a tester who does not know the design still needs to know what
 * the encounter is asking of them.
 */
export class EncounterBanner {
  private readonly title: Phaser.GameObjects.Text;
  private readonly teaches: Phaser.GameObjects.Text;
  private readonly prompt: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene) {
    const right = LAYOUT.width - LAYOUT.hud.margin;

    this.title = scene.add
      .text(right, LAYOUT.hud.margin, '', { fontFamily: FONT, fontSize: TYPE.hud, color: INK })
      .setOrigin(1, 0);

    this.teaches = scene.add
      .text(right, LAYOUT.hud.margin + 34, '', {
        fontFamily: FONT,
        fontSize: TYPE.slotName,
        color: MUTED,
      })
      .setOrigin(1, 0);

    this.prompt = scene.add
      .text(LAYOUT.width / 2, LAYOUT.enemies.centerY + 220, '', {
        fontFamily: FONT,
        fontSize: TYPE.hud,
        color: PLAYER_INK,
        align: 'center',
      })
      .setOrigin(0.5, 0.5);
  }

  render(name: string, teaches: string, prompt: string): void {
    this.title.setText(name);
    this.teaches.setText(teaches);
    this.prompt.setText(prompt);
  }

  destroy(): void {
    this.title.destroy();
    this.teaches.destroy();
    this.prompt.destroy();
  }
}
