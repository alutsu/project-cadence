import Phaser from 'phaser';
import { currentIntent, type Actor } from '../sim/actor.ts';
import type { ActionPreview } from '../sim/forecast.ts';
import type { ActorId } from '../sim/ids.ts';
import { effectivePoise } from '../sim/poise.ts';
import { livingEnemies, type CombatState } from '../sim/state.ts';
import { describeStatuses } from './statusText.ts';
import {
  COLORS,
  ENEMY_INK,
  FONT,
  FX,
  GUARD_INK,
  INK,
  LAYOUT,
  MUTED,
  PLAYER_INK,
  TYPE,
} from './theme.ts';

export interface EnemyLineOptions {
  readonly scene: Phaser.Scene;
  readonly onTarget: (actor: ActorId) => void;
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

  render(state: CombatState, targeted: ActorId | null, preview: ActionPreview | null): void {
    this.container.removeAll(true);
    this.silhouettes = [];

    for (const enemy of livingEnemies(state)) {
      const seat = enemySeat(state, enemy.id);
      if (seat === null) continue;
      const view = this.silhouette({ enemy, x: seat.x, targeted: enemy.id === targeted, preview });
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

  private silhouette(options: SilhouetteOptions): Phaser.GameObjects.Container {
    const { enemy, x, targeted, preview } = options;
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

    const poise = poiseLine(enemy, preview);
    if (poise !== null) {
      view.add(
        scene.add
          .text(0, height / 2 - 66, poise.text, {
            fontFamily: FONT,
            fontSize: TYPE.slotIntent,
            color: poise.color,
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

interface SilhouetteOptions {
  readonly enemy: Actor;
  readonly x: number;
  readonly targeted: boolean;
  /** The hovered action, so the silhouette can answer for itself. */
  readonly preview: ActionPreview | null;
}

/**
 * The Poise line, or null for an actor nothing can stagger (GDD §4.6).
 *
 * Two failures of the M0 gate run live here. `POISE 20` alone is a number with
 * no verb — it never said what a hit has to clear, so the one comparison §4.6
 * builds the whole mechanic around could not be made. And the Stagger verdict
 * only appeared in the hover readout, which names the delay but not *which*
 * enemy takes it; with four silhouettes on screen that is not an answer.
 *
 * So the threshold states its requirement, and while a card is hovered the
 * enemy that card would stagger says so on itself. Both numbers are the sim's:
 * `effectivePoise` is the value Brittle actually moves (GDD §4.5), never
 * `actor.poise`, which would go on printing the pre-Brittle threshold the
 * reducer no longer uses (P3).
 */
export function poiseLine(
  enemy: Actor,
  preview: ActionPreview | null,
): { readonly text: string; readonly color: string } | null {
  const staggered = preview?.staggers.find((entry) => entry.actor === enemy.id);
  if (staggered !== undefined) {
    return { text: `STAGGER +${String(staggered.delay)} ticks`, color: PLAYER_INK };
  }

  if (enemy.poise <= 0) return null;
  const threshold = String(effectivePoise(enemy));
  return { text: `POISE ${threshold} · one hit of ${threshold}+`, color: MUTED };
}
