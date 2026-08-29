import Phaser from 'phaser';
import { findCard } from '../sim/card.ts';
import type { CombatState, CooldownEntry } from '../sim/state.ts';
import { FONT, INK, LAYOUT, MUTED, PLAYER_INK, TYPE } from './theme.ts';

const MAX_ROWS = 8;

/**
 * The Cooldown pile, visible (GDD §4.9). A card's Recovery is a wait the player
 * has to plan around, so the tick it comes back on is shown from the moment it
 * is played — that is what makes waiting for it a decision rather than a hope.
 */
export class PilesPanel {
  private readonly container: Phaser.GameObjects.Container;

  constructor(private readonly scene: Phaser.Scene) {
    this.container = scene.add.container(LAYOUT.hud.margin, LAYOUT.piles.top);
  }

  render(state: CombatState): void {
    this.container.removeAll(true);

    this.container.add(this.row({ y: 0, text: 'COOLDOWN', color: MUTED, size: TYPE.slotIntent }));
    this.container.add(
      this.row({
        y: 26,
        text: `draw ${String(state.draw.length)}   hand ${String(state.hand.length)}`,
        color: INK,
        size: TYPE.slotName,
      }),
    );

    const pending = [...state.cooldown].sort((left, right) => left.returnTick - right.returnTick);
    pending.slice(0, MAX_ROWS).forEach((entry, index) => {
      this.container.add(
        this.row({
          y: 66 + index * 30,
          text: this.describe(state, entry),
          color: PLAYER_INK,
          size: TYPE.slotName,
        }),
      );
    });

    if (pending.length === 0) {
      this.container.add(this.row({ y: 66, text: '—', color: MUTED, size: TYPE.slotName }));
    }
  }

  destroy(): void {
    this.container.destroy(true);
  }

  private describe(state: CombatState, entry: CooldownEntry): string {
    const name = findCard(state.catalogue, entry.card)?.name ?? entry.card;
    const wait = entry.returnTick - state.now;
    return `${name}  t${String(entry.returnTick)}  (${String(wait)})`;
  }

  private row(spec: RowSpec): Phaser.GameObjects.Text {
    const label = this.scene.add.text(0, spec.y, spec.text, {
      fontFamily: FONT,
      fontSize: spec.size,
      color: spec.color,
    });
    label.setOrigin(0, 0);
    return label;
  }
}

interface RowSpec {
  readonly y: number;
  readonly text: string;
  readonly color: string;
  readonly size: string;
}
