import Phaser from 'phaser';
import { ULTIMATE_RULE_NOTES, type CombatRules } from '../sim/rules.ts';
import { FONT, LAYOUT, MUTED, PLAYER_INK, TYPE } from './theme.ts';

const KEYS = [
  'U  ultimate rule',
  'G / H  guard cap −/+',
  'J / K  guard decay −/+',
  'W  guard weight',
  'A  animations   S  sound',
  'R  restart   N  next fight',
] as const;

/** What the presentation switches are currently set to. */
export interface PresentationState {
  readonly animations: boolean;
  readonly sound: boolean;
}

function onOff(on: boolean): string {
  return on ? 'on' : 'off';
}

/**
 * The tuning console (docs/M0_PLAN.md §4, S8). A solo developer cannot chase a
 * feel across a rebuild — the numbers GDD §22 flags as guesses (Guard's cap and
 * decay, the Ultimate rule, the Guard action's Weight) have to move while playing.
 */
export class TuningPanel {
  private readonly lines: Phaser.GameObjects.Text;
  private readonly keys: Phaser.GameObjects.Text;
  private visible = false;

  constructor(scene: Phaser.Scene) {
    // The clear band to the right of the enemies: nothing the player needs
    // during a fight lives there.
    const x = LAYOUT.width - 560;
    const y = LAYOUT.enemies.centerY - 160;

    this.lines = scene.add
      .text(x, y, '', { fontFamily: FONT, fontSize: TYPE.slotName, color: PLAYER_INK })
      .setOrigin(0, 0);
    this.keys = scene.add
      .text(x, y + 140, KEYS.join('\n'), {
        fontFamily: FONT,
        fontSize: TYPE.slotIntent,
        color: MUTED,
      })
      .setOrigin(0, 0);

    this.setVisible(false);
  }

  toggle(): boolean {
    this.setVisible(!this.visible);
    return this.visible;
  }

  render(rules: CombatRules, output: PresentationState): void {
    this.lines.setText(
      [
        `ultimate    ${rules.ultimate}`,
        `            ${ULTIMATE_RULE_NOTES[rules.ultimate]}`,
        `guard       cap ${String(rules.guardCap)}   1 per ${String(rules.guardDecayEvery)} ticks`,
        `guard act   W${String(rules.guardWeight)}   +${String(rules.guardGain)} guard`,
        `animations  ${onOff(output.animations)}   sound  ${onOff(output.sound)}`,
      ].join('\n'),
    );
  }

  destroy(): void {
    this.lines.destroy();
    this.keys.destroy();
  }

  private setVisible(visible: boolean): void {
    this.visible = visible;
    this.lines.setVisible(visible);
    this.keys.setVisible(visible);
  }
}
