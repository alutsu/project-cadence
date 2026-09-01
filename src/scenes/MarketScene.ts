import Phaser from 'phaser';
import { buyMaterial, removeCard, type MarketRefusal } from '../run/market.ts';
import { MATERIAL_NAMES } from '../run/materials.ts';
import type { RunState } from '../run/RunState.ts';
import type { GemTier } from '../sim/gem.ts';
import type { CardId } from '../sim/ids.ts';
import { MarketView } from '../ui/MarketView.ts';
import { COLORS } from '../ui/theme.ts';
import { runSceneData, type Refreshable, type RunSceneData } from './sceneData.ts';

/**
 * The Market (GDD §9, §11).
 *
 * > The node types pay in **different currencies** (XP vs. HP vs. gold), so
 * > they can't be ranked against each other — there's nothing to solve.
 *
 * This is the node that pays in **gold**, and the one the map has been offering
 * since the map existed while doing nothing at all — it pointed at the map
 * scene, so entering a Market showed you the map you had just left.
 *
 * Wiring only. `market.ts` owns every price and every refusal (CLAUDE.md §4.1).
 */
export class MarketScene extends Phaser.Scene implements Refreshable {
  private payload: RunSceneData | null = null;
  private view: MarketView | null = null;

  constructor() {
    super('Market');
  }

  init(data: unknown): void {
    this.payload = runSceneData(data, 'MarketScene');
  }

  /** A new run, same screen — the armed removal is kept, it is not game state. */
  refresh(data: RunSceneData): void {
    this.payload = data;
    this.render();
  }

  create(): void {
    const payload = this.payload;
    if (payload === null) return;

    this.cameras.main.setBackgroundColor(COLORS.background);
    this.view = new MarketView({
      scene: this,
      onBuy: (tier) => {
        this.buy(tier);
      },
      onRemove: (card) => {
        this.remove(card);
      },
      onLeave: () => {
        payload.dispatch({ kind: 'leaveNode' });
      },
    });

    this.installKeys();
    this.render();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.view?.destroy();
      this.view = null;
    });
  }

  private run(): RunState {
    const payload = this.payload;
    if (payload === null) throw new Error('MarketScene has no run');
    return payload.run;
  }

  private buy(tier: GemTier): void {
    const bought = buyMaterial(this.run(), tier);
    if (!bought.ok) {
      this.say(refusalText(bought.refusal, MATERIAL_NAMES[tier]));
      return;
    }

    this.payload?.dispatch({ kind: 'trade', run: bought.run });
    this.render();
  }

  private remove(card: CardId): void {
    const removed = removeCard(this.run(), card);
    if (!removed.ok) {
      this.say(refusalText(removed.refusal, card));
      return;
    }

    this.view?.clearArming();
    this.payload?.dispatch({ kind: 'trade', run: removed.run });
    this.render();
  }

  /** A refused act has to say so; a control that silently does nothing reads as broken. */
  private say(reason: string): void {
    this.view?.notice(reason);
    this.render();
  }

  private installKeys(): void {
    const keys = this.input.keyboard;
    if (keys === null) return;

    for (const digit of ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN']) {
      keys.on(`keydown-${digit}`, () => {
        this.view?.press(this.run(), DIGITS.indexOf(digit));
      });
    }
    keys.on('keydown-ESC', () => {
      this.payload?.dispatch({ kind: 'leaveNode' });
    });
  }

  private render(): void {
    this.view?.render(this.run());
  }
}

const DIGITS: readonly string[] = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN'];

/** Every branch names the thing the player can change (CLAUDE.md §5.4). */
function refusalText(refusal: MarketRefusal, subject: string): string {
  switch (refusal.reason) {
    case 'no-price':
      return refusal.detail;
    case 'too-poor':
      return `that costs ${String(refusal.price)} gold, and you have less`;
    case 'ladder-spent':
      return 'you have used every removal a run allows';
    case 'deck-floor':
      return 'the deck is as thin as it goes';
    case 'signature':
      return `${subject} is your signature — it carries the opening socket`;
    case 'not-in-deck':
      return `${subject} is not in your deck`;
  }
}
