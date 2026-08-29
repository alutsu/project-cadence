import Phaser from 'phaser';
import type { QueueSlot } from '../sim/forecast.ts';
import { forecastQueue } from '../sim/forecast.ts';
import { findActor, type CombatState } from '../sim/state.ts';
import { COLORS, ENEMY_INK, FONT, INK, LAYOUT, MUTED, PLAYER_INK, TYPE } from './theme.ts';

/**
 * The eight-slot queue (GDD §4.2) — the single most important thing on screen.
 * It is a pure projection of sim state: the strip never computes a tick, it only
 * renders the forecast it is handed.
 */
export class QueueStrip {
  private readonly container: Phaser.GameObjects.Container;

  constructor(private readonly scene: Phaser.Scene) {
    this.container = scene.add.container(0, 0);
  }

  render(state: CombatState): void {
    this.container.removeAll(true);
    forecastQueue(state).forEach((slot, index) => {
      this.container.add(this.slotView(state, slot, index));
    });
  }

  destroy(): void {
    this.container.destroy(true);
  }

  private slotView(
    state: CombatState,
    slot: QueueSlot,
    index: number,
  ): Phaser.GameObjects.Container {
    const { queue } = LAYOUT;
    const totalWidth = queue.slotWidth * 8 + queue.gap * 7;
    const x = (LAYOUT.width - totalWidth) / 2 + index * (queue.slotWidth + queue.gap);
    const actor = findActor(state, slot.actor);
    const isPlayer = actor?.side === 'player';

    const view = this.scene.add.container(
      x + queue.slotWidth / 2,
      queue.top + queue.slotHeight / 2,
    );
    const panel = this.scene.add.rectangle(0, 0, queue.slotWidth, queue.slotHeight, COLORS.panel);
    panel.setStrokeStyle(2, isPlayer ? COLORS.player : COLORS.panelEdge);
    view.add(panel);

    // The player has no portrait to show — the camera is their eyes (GDD §15.1),
    // so their slots carry the held-card mark instead of an invented avatar.
    const mark = isPlayer ? '[ ]' : '◆';
    view.add(
      this.scene.add
        .text(-queue.slotWidth / 2 + 14, -queue.slotHeight / 2 + 10, mark, {
          fontFamily: FONT,
          fontSize: TYPE.slotName,
          color: isPlayer ? PLAYER_INK : ENEMY_INK,
        })
        .setOrigin(0, 0),
    );

    view.add(
      this.scene.add
        .text(queue.slotWidth / 2 - 14, -queue.slotHeight / 2 + 10, `t${String(slot.at)}`, {
          fontFamily: FONT,
          fontSize: TYPE.slotTick,
          color: isPlayer ? PLAYER_INK : INK,
        })
        .setOrigin(1, 0),
    );

    view.add(
      this.scene.add
        .text(0, 8, actor?.name ?? '—', {
          fontFamily: FONT,
          fontSize: TYPE.slotName,
          color: isPlayer ? PLAYER_INK : INK,
        })
        .setOrigin(0.5, 0.5),
    );

    // Enemy intents are telegraphed, which is what makes the forecast honest.
    const intent = actor?.intent;
    const caption = isPlayer
      ? 'your turn'
      : intent === null || intent === undefined
        ? '—'
        : `${intent.name} ${String(intent.damage)}`;
    view.add(
      this.scene.add
        .text(0, 36, caption, { fontFamily: FONT, fontSize: TYPE.slotIntent, color: MUTED })
        .setOrigin(0.5, 0.5),
    );

    return view;
  }
}
