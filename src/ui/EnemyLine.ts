import Phaser from 'phaser';
import { isAlive, type Actor } from '../sim/actor.ts';
import type { ActorId } from '../sim/ids.ts';
import type { CombatState } from '../sim/state.ts';
import { describeStatuses } from './statusText.ts';
import { COLORS, ENEMY_INK, FONT, GUARD_INK, INK, LAYOUT, MUTED, TYPE } from './theme.ts';

export interface EnemyLineOptions {
  readonly scene: Phaser.Scene;
  readonly onTarget: (actor: ActorId) => void;
}

/**
 * Enemies stand in front of the camera, facing the player (GDD §15.1). Flat
 * silhouettes: the intent badge and the HP figure carry the information, and no
 * art is loaded to say the same thing less clearly.
 */
export class EnemyLine {
  private readonly container: Phaser.GameObjects.Container;

  constructor(private readonly options: EnemyLineOptions) {
    this.container = options.scene.add.container(0, 0);
  }

  render(state: CombatState, targeted: ActorId | null): void {
    this.container.removeAll(true);

    const enemies = state.actors.filter((actor) => actor.side === 'enemy' && isAlive(actor));
    const { width, gap } = LAYOUT.enemies;
    const step = width + gap;
    const middle = (enemies.length - 1) / 2;

    enemies.forEach((enemy, index) => {
      const x = LAYOUT.width / 2 + (index - middle) * step;
      this.container.add(this.silhouette(enemy, x, enemy.id === targeted));
    });
  }

  destroy(): void {
    this.container.destroy(true);
  }

  private silhouette(enemy: Actor, x: number, targeted: boolean): Phaser.GameObjects.Container {
    const scene = this.options.scene;
    const { width, height, centerY } = LAYOUT.enemies;
    const view = scene.add.container(x, centerY);

    const body = scene.add.rectangle(0, 0, width, height, COLORS.panel);
    body.setStrokeStyle(targeted ? 4 : 2, targeted ? COLORS.danger : COLORS.panelEdge);
    body.setInteractive({ useHandCursor: true });
    body.on('pointerdown', () => {
      this.options.onTarget(enemy.id);
    });
    view.add(body);

    view.add(
      scene.add
        .text(0, -height / 2 + 30, enemy.name, {
          fontFamily: FONT,
          fontSize: TYPE.enemyName,
          color: ENEMY_INK,
        })
        .setOrigin(0.5, 0.5),
    );

    view.add(
      scene.add
        .text(0, -height / 2 + 66, `${String(enemy.hp)} / ${String(enemy.maxHp)} HP`, {
          fontFamily: FONT,
          fontSize: TYPE.enemyHp,
          color: INK,
        })
        .setOrigin(0.5, 0.5),
    );

    // The Poise threshold is the number the player compares a card's damage to,
    // so it is on the silhouette rather than in a tooltip (GDD §4.6, §15).
    if (enemy.poise > 0) {
      view.add(
        scene.add
          .text(0, height / 2 - 66, `POISE ${String(enemy.poise)}`, {
            fontFamily: FONT,
            fontSize: TYPE.slotIntent,
            color: MUTED,
          })
          .setOrigin(0.5, 0.5),
      );
    }

    const condition = [
      enemy.guard > 0 ? `GUARD ${String(enemy.guard)}` : '',
      describeStatuses(enemy.statuses),
    ]
      .filter((part) => part.length > 0)
      .join('  ·  ');
    if (condition.length > 0) {
      view.add(
        scene.add
          .text(0, -height / 2 + 96, condition, {
            fontFamily: FONT,
            fontSize: TYPE.slotIntent,
            color: GUARD_INK,
          })
          .setOrigin(0.5, 0.5),
      );
    }

    const intent = enemy.intent;
    const telegraph =
      intent === null
        ? 'waiting'
        : `${intent.name}  ${String(intent.damage)} dmg  W${String(intent.weight)}`;
    view.add(
      scene.add
        .text(0, height / 2 - 40, telegraph, {
          fontFamily: FONT,
          fontSize: TYPE.slotIntent,
          color: MUTED,
        })
        .setOrigin(0.5, 0.5),
    );

    view.add(
      scene.add
        .text(0, height / 2 - 14, `acts at t${String(enemy.nextActTick)}`, {
          fontFamily: FONT,
          fontSize: TYPE.slotIntent,
          color: targeted ? ENEMY_INK : MUTED,
        })
        .setOrigin(0.5, 0.5),
    );

    return view;
  }
}
