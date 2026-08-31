import Phaser from 'phaser';
import { performForgeAction, type RunState } from '../run/RunState.ts';
import { FRAMES, type Frame } from '../sim/gem.ts';
import type { CardId } from '../sim/ids.ts';
import { ForgeScreen, type ForgeAction } from '../ui/ForgeScreen.ts';
import { SanctumView } from '../ui/SanctumView.ts';
import { COLORS } from '../ui/theme.ts';
import { runSceneData, type RunSceneData } from './sceneData.ts';

/**
 * The Sanctum (GDD §11).
 *
 * > Each offers 2 Dungeons, 1 Sanctum, 1 Market … The node types pay in
 * > **different currencies** (XP vs. HP vs. gold), so they can't be ranked
 * > against each other — there's nothing to solve.
 *
 * The Sanctum pays in **HP**, and it is where the forge lives: §6.1's sockets
 * and §6.2's crafting are the build being *made*, and P5's budget for the
 * combat screen is already spent on the queue and the hand. Making the build
 * away from where it is used costs the fight nothing.
 *
 * Wiring only. Every act goes through `performForgeAction`, which is the run's
 * to perform (CLAUDE.md §4.1).
 */
export class SanctumScene extends Phaser.Scene {
  private payload: RunSceneData | null = null;
  private view: SanctumView | null = null;
  private forge: ForgeScreen | null = null;
  /** Which card and frame the next forge act applies to. Presentation state. */
  private card: CardId | null = null;
  private frameIndex = 0;

  constructor() {
    super('Sanctum');
  }

  init(data: unknown): void {
    this.payload = runSceneData(data, 'SanctumScene');
    this.card = null;
    this.frameIndex = 0;
  }

  create(): void {
    const payload = this.payload;
    if (payload === null) return;

    this.cameras.main.setBackgroundColor(COLORS.background);
    this.view = new SanctumView({
      scene: this,
      onRest: () => {
        payload.dispatch({ kind: 'rest' });
      },
      onForge: () => {
        this.forge?.toggle();
        this.render();
      },
      onLeave: () => {
        payload.dispatch({ kind: 'leaveNode' });
      },
    });
    this.forge = new ForgeScreen({
      scene: this,
      onAct: (action) => {
        this.act(action);
      },
      onClose: () => {
        this.forge?.toggle();
        this.render();
      },
    });

    this.installKeys();
    this.render();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.view?.destroy();
      this.forge?.destroy();
      this.view = null;
      this.forge = null;
    });
  }

  private run(): RunState {
    const payload = this.payload;
    if (payload === null) throw new Error('SanctumScene has no run');
    return payload.run;
  }

  /**
   * The run performs the act; the screen only asked for it. A refused act
   * leaves the run alone and re-renders unchanged — an illegal act is an
   * expected failure, not an exception (CLAUDE.md §5.4).
   */
  private act(action: ForgeAction): void {
    const performed = performForgeAction(this.run(), action);
    if (performed !== null) this.payload?.dispatch({ kind: 'forge', run: performed });
    this.render();
  }

  private installKeys(): void {
    const keys = this.input.keyboard;
    if (keys === null) return;

    const forgeAct = (kind: ForgeAction['kind'], frame: Frame | null = null): void => {
      if (this.forge?.isOpen() !== true) return;
      this.forge.act({ kind, card: this.card, frame, tier: 1 }, this.run());
      this.render();
    };

    keys.on('keydown-F', () => {
      this.forge?.toggle();
      this.render();
    });
    keys.on('keydown-C', () => {
      forgeAct('craft', FRAMES[this.frameIndex] ?? 'REPEAT');
    });
    keys.on('keydown-S', () => {
      forgeAct('socket');
    });
    keys.on('keydown-E', () => {
      forgeAct('seat');
    });
    keys.on('keydown-X', () => {
      forgeAct('unseat');
    });
    keys.on('keydown-R', () => {
      forgeAct('reroll');
    });
    keys.on('keydown-U', () => {
      forgeAct('upgrade');
    });

    for (const [index, digit] of DIGITS.entries()) {
      keys.on(`keydown-${digit}`, () => {
        this.pick(index);
      });
    }
  }

  /** Which deck card, and which frame, the next act applies to. */
  private pick(index: number): void {
    if (this.forge?.isOpen() !== true) return;

    const distinct = [...new Set(this.run().deck)];
    this.card = distinct[index] ?? this.card;
    this.frameIndex = index % FRAMES.length;
    this.render();
  }

  private render(): void {
    if (this.payload?.view.kind !== 'sanctum') return;

    this.view?.render(this.run());
    this.forge?.render(this.run(), this.card, FRAMES[this.frameIndex] ?? 'REPEAT');
  }
}

const DIGITS: readonly string[] = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN'];
