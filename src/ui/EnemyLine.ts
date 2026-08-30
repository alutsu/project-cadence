import Phaser from 'phaser';
import { currentIntent, isAlive, type Actor } from '../sim/actor.ts';
import type { ActorId } from '../sim/ids.ts';
import type { CombatState } from '../sim/state.ts';
import { describeStatuses } from './statusText.ts';
import { COLORS, ENEMY_INK, FONT, FX, GUARD_INK, INK, LAYOUT, MUTED, TYPE } from './theme.ts';

export interface EnemyLineOptions {
  readonly scene: Phaser.Scene;
  readonly onTarget: (actor: ActorId) => void;
}

/** The living enemies, in the order they are drawn. */
export function livingEnemies(state: CombatState): readonly Actor[] {
  return state.actors.filter((actor) => actor.side === 'enemy' && isAlive(actor));
}

/**
 * Where an enemy stands, or null if it is not on screen. Exported so a hit can
 * be drawn at the silhouette it belongs to — including one that has just died
 * and is therefore gone from the line by the time the animation plays.
 */
export function enemySeat(
  state: CombatState,
  actor: ActorId,
): { readonly x: number; readonly y: number } | null {
  const enemies = livingEnemies(state);
  const index = enemies.findIndex((enemy) => enemy.id === actor);
  if (index === -1) return null;

  const { width, gap, centerY } = LAYOUT.enemies;
  const fromCenter = index - (enemies.length - 1) / 2;
  return { x: LAYOUT.width / 2 + fromCenter * (width + gap), y: centerY };
}

interface Silhouette {
  readonly actor: ActorId;
  readonly view: Phaser.GameObjects.Container;
}

/**
 * Enemies stand in front of the camera, facing the player (GDD §15.1). Flat
 * silhouettes: the intent badge and the HP figure carry the information, and no
 * art is loaded to say the same thing less clearly.
 */
export class EnemyLine {
  private readonly container: Phaser.GameObjects.Container;
  private silhouettes: Silhouette[] = [];

  constructor(private readonly options: EnemyLineOptions) {
    this.container = options.scene.add.container(0, 0);
  }

  render(state: CombatState, targeted: ActorId | null): void {
    this.container.removeAll(true);
    this.silhouettes = [];

    for (const enemy of livingEnemies(state)) {
      const seat = enemySeat(state, enemy.id);
      if (seat === null) continue;
      const view = this.silhouette(enemy, seat.x, enemy.id === targeted);
      this.container.add(view);
      this.silhouettes.push({ actor: enemy.id, view });
    }
  }

  /** A struck enemy recoils. Survivors only — the dead are no longer drawn. */
  flashHit(actor: ActorId): void {
    const hit = this.silhouettes.find((candidate) => candidate.actor === actor);
    if (hit === undefined) return;

    this.options.scene.tweens.add({
      targets: hit.view,
      x: hit.view.x + FX.recoilPixels,
      duration: FX.recoilMs,
      yoyo: true,
      ease: 'Quad.easeOut',
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

    const intent = currentIntent(enemy);
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
