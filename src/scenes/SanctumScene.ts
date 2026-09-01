import Phaser from 'phaser';
import { performForgeAction, type RunState } from '../run/RunState.ts';
import { FRAMES, GEM_TIERS, type Frame, type GemTier } from '../sim/gem.ts';
import type { CardId } from '../sim/ids.ts';
import { ForgeScreen, type ForgeAction } from '../ui/ForgeScreen.ts';
import { SanctumView } from '../ui/SanctumView.ts';
import { COLORS } from '../ui/theme.ts';
import { MATERIAL_NAMES, materialsHeld } from '../run/materials.ts';
import { runSceneData, type Refreshable, type RunSceneData } from './sceneData.ts';

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
export class SanctumScene extends Phaser.Scene implements Refreshable {
  private payload: RunSceneData | null = null;
  private view: SanctumView | null = null;
  private forge: ForgeScreen | null = null;
  /** Which card and frame the next forge act applies to. Presentation state. */
  private card: CardId | null = null;
  private frameIndex = 0;
  /** Why the last act did nothing, if it did nothing. */
  private notice = '';
  /**
   * Which tier `C` would craft, and `U` would upgrade.
   *
   * It was pinned to 1, which made every material above Shard unspendable —
   * and `U`'s whole job is to turn three Shards into one of those. The ladder
   * §9 defines had no top four rungs in practice.
   */
  private tier: GemTier = 1;

  constructor() {
    super('Sanctum');
  }

  init(data: unknown): void {
    this.payload = runSceneData(data, 'SanctumScene');
    this.card = null;
    this.frameIndex = 0;
  }

  /**
   * A new run, same screen. Keeps the picked card and whether the forge is
   * open, because both are things the player set up and neither is game state.
   */
  refresh(data: RunSceneData): void {
    this.payload = data;
    this.render();
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
    if (performed === null) {
      // An act the run refused. It has to *say* so: a key that silently does
      // nothing is indistinguishable from one that is not wired up, which is
      // what crafting looked like when the forge was closing itself.
      this.notice = refusalFor(action, this.run());
      this.render();
      return;
    }

    this.notice = '';
    this.payload?.dispatch({ kind: 'forge', run: performed });
    this.render();
  }

  private installKeys(): void {
    const keys = this.input.keyboard;
    if (keys === null) return;

    const forgeAct = (kind: ForgeAction['kind'], frame: Frame | null = null): void => {
      if (this.forge?.isOpen() !== true) return;
      this.forge.act({ kind, card: this.card, frame, tier: this.tier }, this.run());
      this.render();
    };

    keys.on('keydown-F', () => {
      this.forge?.toggle();
      this.render();
    });
    keys.on('keydown-Q', () => {
      this.cycleFrame();
    });
    keys.on('keydown-T', () => {
      this.cycleTier();
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

  /** Which deck card the next act applies to. */
  private pick(index: number): void {
    if (this.forge?.isOpen() !== true) return;

    this.card = [...new Set(this.run().deck)][index] ?? this.card;
    this.notice = '';
    this.render();
  }

  /**
   * Which frame `C` would craft. On its own key, because a number used to do
   * both — picking a card silently changed what you were about to craft, which
   * is two decisions wearing one button.
   */
  private cycleFrame(): void {
    if (this.forge?.isOpen() !== true) return;

    this.frameIndex = (this.frameIndex + 1) % FRAMES.length;
    this.notice = '';
    this.render();
  }

  /** Which tier the next craft or upgrade uses. */
  private cycleTier(): void {
    if (this.forge?.isOpen() !== true) return;

    const next = GEM_TIERS[(GEM_TIERS.indexOf(this.tier) + 1) % GEM_TIERS.length];
    this.tier = next ?? 1;
    this.notice = '';
    this.render();
  }

  private render(): void {
    if (this.payload?.view.kind !== 'sanctum') return;

    this.view?.render(this.run());
    this.forge?.render(this.run(), {
      selected: this.card,
      frame: FRAMES[this.frameIndex] ?? 'REPEAT',
      tier: this.tier,
      notice: this.notice,
    });
  }
}

const DIGITS: readonly string[] = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN'];

/**
 * Why an act did nothing. Every branch names something the player can change,
 * because "nothing happened" is the least useful thing an interface can say.
 */
function refusalFor(action: ForgeAction, run: RunState): string {
  if (action.card === null && action.kind !== 'craft' && action.kind !== 'upgrade') {
    return 'pick a card first — press 1 to 7';
  }
  if (action.kind === 'craft') {
    const name = MATERIAL_NAMES[action.tier];
    return materialsHeld(run.materials) === 0
      ? 'no materials at all — win a fight first'
      : `no ${name} to craft with — press T for a tier you hold`;
  }
  if (action.kind === 'upgrade') {
    return `three ${MATERIAL_NAMES[action.tier]} make one of the next tier, and you have fewer`;
  }
  if (action.kind === 'seat') {
    return run.pouch.length === 0
      ? 'no gem to set — craft one with C'
      : 'that card has no open socket — open one with S';
  }
  if (action.kind === 'unseat') return 'that card has no gem in it';
  if (action.kind === 'reroll') return 'rerolling costs 1 insight, and you have none';

  return 'that socket cannot be opened — the forge lists why above';
}
