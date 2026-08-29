import Phaser from 'phaser';
import type { ActionPreview, QueueSlot } from '../sim/forecast.ts';
import { forecastQueue } from '../sim/forecast.ts';
import type { ActorId } from '../sim/ids.ts';
import { findActor, type CombatState } from '../sim/state.ts';
import type { Tick } from '../sim/tick.ts';
import { COLORS, ENEMY_INK, FONT, INK, LAYOUT, MUTED, PLAYER_INK, TYPE } from './theme.ts';

interface SlotOptions {
  readonly state: CombatState;
  readonly slot: QueueSlot;
  readonly index: number;
  readonly ghost: GhostContext | null;
}

interface GhostContext {
  /** Index of the player's slot in the projected queue, or -1 if absent. */
  readonly playerIndex: number;
  readonly livePlayerTick: Tick | null;
}

/**
 * The eight-slot queue (GDD §4.2) — the single most important thing on screen.
 * It is a pure projection of sim state: the strip never computes a tick, it only
 * renders the forecast it is handed.
 *
 * Given a preview, it re-renders in ghost form: the queue as it *would* be, with
 * the player's own move marked against where they stand now, and every enemy
 * turn that would land first called out. That comparison is the whole game.
 */
export class QueueStrip {
  private readonly container: Phaser.GameObjects.Container;
  private slots: { actor: ActorId; view: Phaser.GameObjects.Container }[] = [];

  constructor(private readonly scene: Phaser.Scene) {
    this.container = scene.add.container(0, 0);
  }

  /**
   * The payoff moment (GDD §4.6): the staggered actor's slot kicks back and
   * says how far it slid. The only real animation in M0, and it is spent here
   * deliberately — this is the beat the whole system builds towards.
   */
  flashStagger(actor: ActorId, delay: number): void {
    const slot = this.slots.find((candidate) => candidate.actor === actor);
    if (slot === undefined) return;

    this.scene.tweens.add({
      targets: slot.view,
      x: slot.view.x + STAGGER_KICK,
      duration: 90,
      yoyo: true,
      ease: 'Quad.easeOut',
    });

    const label = this.scene.add
      .text(slot.view.x, slot.view.y - LAYOUT.queue.slotHeight / 2 - 6, `+${String(delay)}`, {
        fontFamily: FONT,
        fontSize: TYPE.slotTick,
        color: STAGGER_INK,
      })
      .setOrigin(0.5, 1);

    this.scene.tweens.add({
      targets: label,
      y: label.y - 26,
      alpha: 0,
      duration: 620,
      ease: 'Quad.easeOut',
      onComplete: () => {
        label.destroy();
      },
    });
  }

  render(state: CombatState, preview: ActionPreview | null = null): void {
    this.container.removeAll(true);
    this.slots = [];

    const live = forecastQueue(state);
    const slots = preview === null ? live : preview.queue;
    const ghost: GhostContext | null =
      preview === null
        ? null
        : {
            playerIndex: preview.queue.findIndex(
              (slot) => findActor(state, slot.actor)?.side === 'player',
            ),
            livePlayerTick: playerTick(state, live),
          };

    slots.forEach((slot, index) => {
      const view = this.slotView({ state, slot, index, ghost });
      this.slots.push({ actor: slot.actor, view });
      this.container.add(view);
    });
  }

  destroy(): void {
    this.container.destroy(true);
  }

  private slotView(options: SlotOptions): Phaser.GameObjects.Container {
    const { state, slot, index, ghost } = options;
    const { queue } = LAYOUT;
    const actor = findActor(state, slot.actor);
    const isPlayer = actor?.side === 'player';
    const landsFirst =
      ghost !== null && !isPlayer && ghost.playerIndex !== -1 && index < ghost.playerIndex;

    const totalWidth = queue.slotWidth * 8 + queue.gap * 7;
    const x = (LAYOUT.width - totalWidth) / 2 + index * (queue.slotWidth + queue.gap);
    const view = this.scene.add.container(
      x + queue.slotWidth / 2,
      queue.top + queue.slotHeight / 2,
    );

    const panel = this.scene.add.rectangle(0, 0, queue.slotWidth, queue.slotHeight, COLORS.panel);
    panel.setStrokeStyle(landsFirst ? 3 : 2, strokeFor(isPlayer, landsFirst));
    view.add(panel);
    if (ghost !== null) view.setAlpha(GHOST_ALPHA);

    // The player has no portrait to show — the camera is their eyes (GDD §15.1),
    // so their slots carry the held-card mark instead of an invented avatar.
    view.add(
      this.text({
        x: -queue.slotWidth / 2 + 14,
        y: -queue.slotHeight / 2 + 10,
        value: isPlayer ? '[ ]' : '◆',
        size: TYPE.slotName,
        color: isPlayer ? PLAYER_INK : ENEMY_INK,
        origin: { x: 0, y: 0 },
      }),
    );

    view.add(
      this.text({
        x: queue.slotWidth / 2 - 14,
        y: -queue.slotHeight / 2 + 10,
        value: `t${String(slot.at)}`,
        size: TYPE.slotTick,
        color: isPlayer ? PLAYER_INK : INK,
        origin: { x: 1, y: 0 },
      }),
    );

    view.add(
      this.text({
        x: 0,
        y: 8,
        value: slot.kind === 'strike' ? (slot.intent?.name ?? '—') : (actor?.name ?? '—'),
        size: TYPE.slotName,
        color: isPlayer ? PLAYER_INK : INK,
        origin: CENTERED,
      }),
    );

    view.add(
      this.text({
        x: 0,
        y: 36,
        value: caption(options, isPlayer, landsFirst),
        size: TYPE.slotIntent,
        color: captionInk(landsFirst),
        origin: CENTERED,
      }),
    );

    return view;
  }

  private text(spec: TextSpec): Phaser.GameObjects.Text {
    return this.scene.add
      .text(spec.x, spec.y, spec.value, {
        fontFamily: FONT,
        fontSize: spec.size,
        color: spec.color,
      })
      .setOrigin(spec.origin.x, spec.origin.y);
  }
}

interface TextSpec {
  readonly x: number;
  readonly y: number;
  readonly value: string;
  readonly size: string;
  readonly color: string;
  readonly origin: { readonly x: number; readonly y: number };
}

const CENTERED = { x: 0.5, y: 0.5 } as const;

const GHOST_ALPHA = 0.9;
const STAGGER_KICK = 26;
const STAGGER_INK = '#e0705f';

function strokeFor(isPlayer: boolean, landsFirst: boolean): number {
  if (isPlayer) return COLORS.player;
  return landsFirst ? COLORS.danger : COLORS.panelEdge;
}

function captionInk(landsFirst: boolean): string {
  return landsFirst ? '#e0705f' : MUTED;
}

function playerTick(state: CombatState, queue: readonly QueueSlot[]): Tick | null {
  return queue.find((slot) => findActor(state, slot.actor)?.side === 'player')?.at ?? null;
}

function caption(options: SlotOptions, isPlayer: boolean, landsFirst: boolean): string {
  const { slot, ghost } = options;

  if (slot.kind === 'strike') return `lands · ${String(slot.intent?.damage ?? 0)} dmg`;

  if (isPlayer) {
    const from = ghost?.livePlayerTick;
    return from === undefined || from === null ? 'your turn' : `now t${String(from)}`;
  }

  const intent = slot.intent;
  if (intent === null) return '—';

  // In ghost form the slot already names the actor, so the caption spends its
  // width on what the player is deciding about: this one acts before you do.
  return landsFirst
    ? `first · ${String(intent.damage)} dmg`
    : `${intent.name} ${String(intent.damage)}`;
}
