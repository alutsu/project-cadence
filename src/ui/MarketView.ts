import Phaser from 'phaser';
import { MATERIAL_NAMES } from '../run/materials.ts';
import { materialPrice } from '../run/economy.ts';
import { nextRemovalPrice, DECK_FLOOR } from '../run/market.ts';
import { SIGNATURE_CARD, type RunState } from '../run/RunState.ts';
import { GEM_TIERS, type GemTier } from '../sim/gem.ts';
import type { CardId } from '../sim/ids.ts';
import {
  COLORS,
  DANGER_INK,
  FONT,
  GUARD_INK,
  INK,
  LAYOUT,
  MUTED,
  PLAYER_INK,
  TYPE,
} from './theme.ts';

/**
 * The Market (GDD §9, §11, §15.2).
 *
 * §11 offers one against two Dungeons and a Sanctum, and taking it spends one
 * of the two nodes the Depth grants — so the screen leads with what the stop
 * bought, not with a shop front. Two shelves: materials, and thinning the deck.
 *
 * Relics are §10's and are the next sprint's. The screen says so, because an
 * empty shelf with no explanation is the same failure the Sanctum had — true,
 * and useless.
 *
 * §15.2: removal is irreversible and confirms twice. Buying a material is not
 * (the material is still there afterwards), so it does not.
 */

export interface MarketOptions {
  readonly scene: Phaser.Scene;
  readonly onBuy: (tier: GemTier) => void;
  readonly onRemove: (card: CardId) => void;
  readonly onLeave: () => void;
}

interface Shelf {
  readonly title: string;
  readonly what: string;
  readonly cost: string;
  /** Null when it can be taken; otherwise the reason it cannot. */
  readonly blocked: string | null;
  readonly onPress: () => void;
}

const CARD = { width: 380, height: 250, gap: 40, y: 880 } as const;
/**
 * The deck list is bounded by the keys that drive it: seven rows, because there
 * are seven number keys. A deck grows to sixteen distinct cards by §5.1's table,
 * and rendering rows nobody can press would be eight ways to press nothing.
 */
const DECK = { top: 420, rows: 7 } as const;

export class MarketView {
  private readonly options: MarketOptions;
  private readonly heading: Phaser.GameObjects.Text;
  private readonly carried: Phaser.GameObjects.Text;
  private readonly deck: Phaser.GameObjects.Text;
  private readonly prompt: Phaser.GameObjects.Text;
  private cards: Phaser.GameObjects.Container[] = [];
  /** A removal waiting on its second press (§15.2). */
  private arming: CardId | null = null;
  /** Why the last act did nothing, if it did nothing. */
  private refusal = '';

  constructor(options: MarketOptions) {
    this.options = options;
    const { scene } = options;

    this.heading = scene.add
      .text(LAYOUT.width / 2, 190, '', {
        fontFamily: FONT,
        fontSize: TYPE.button,
        color: GUARD_INK,
        align: 'center',
        lineSpacing: 16,
      })
      .setOrigin(0.5, 0.5);
    this.carried = scene.add
      .text(LAYOUT.width / 2, 300, '', {
        fontFamily: FONT,
        fontSize: TYPE.slotName,
        color: MUTED,
        align: 'center',
        lineSpacing: 10,
      })
      .setOrigin(0.5, 0);
    this.deck = scene.add
      .text(LAYOUT.width / 2, DECK.top, '', {
        fontFamily: FONT,
        fontSize: TYPE.slotName,
        color: INK,
        align: 'left',
        lineSpacing: 8,
      })
      .setOrigin(0.5, 0);
    this.prompt = scene.add
      .text(LAYOUT.width / 2, LAYOUT.forge.promptY, '', {
        fontFamily: FONT,
        fontSize: TYPE.button,
        color: DANGER_INK,
        align: 'center',
      })
      .setOrigin(0.5, 0.5);
  }

  render(run: RunState): void {
    this.clear();

    this.heading.setText('THE MARKET\ngold spends here — then move on');
    this.carried.setText(carriedLines(run).join('\n'));
    this.deck.setText(deckLines(run, this.arming).join('\n'));
    this.prompt.setText(
      this.arming === null
        ? this.refusal
        : `press ${keyOf(run, this.arming)} again — the card is gone for good`,
    );

    const shelves = [
      ...GEM_TIERS.filter(isBuyable).map((tier) => materialShelf(run, tier, this.options.onBuy)),
      moveOn(this.options.onLeave),
    ];
    this.cards = shelves.map((shelf, index) => this.card(shelf, index, shelves.length));
  }

  /**
   * A number key, meaning the nth distinct card in the deck. Irreversible, so
   * the first press arms and the second commits — the same shape the forge uses,
   * rather than a modal that steals the keyboard.
   */
  press(run: RunState, index: number): void {
    const card = distinctDeck(run)[index];
    if (card === undefined) return;

    this.refusal = '';
    if (this.arming === card) {
      this.arming = null;
      this.options.onRemove(card);
      return;
    }

    this.arming = card;
    this.render(run);
  }

  clearArming(): void {
    this.arming = null;
  }

  /** Says why an act was refused. Outranks nothing — a pending confirm wins. */
  notice(reason: string): void {
    this.refusal = reason;
  }

  destroy(): void {
    this.clear();
    this.heading.destroy();
    this.carried.destroy();
    this.deck.destroy();
    this.prompt.destroy();
  }

  private clear(): void {
    for (const card of this.cards) card.destroy(true);
    this.cards = [];
  }

  private card(shelf: Shelf, index: number, count: number): Phaser.GameObjects.Container {
    const { scene } = this.options;
    const available = shelf.blocked === null;
    const fromCentre = index - (count - 1) / 2;
    const container = scene.add.container(
      LAYOUT.width / 2 + fromCentre * (CARD.width + CARD.gap),
      CARD.y,
    );

    const panel = scene.add
      .rectangle(0, 0, CARD.width, CARD.height, COLORS.panel)
      .setStrokeStyle(2, available ? COLORS.guard : COLORS.panelEdge);
    if (available) {
      panel.setInteractive({ useHandCursor: true });
      panel.on('pointerover', () => {
        panel.setFillStyle(COLORS.panelActive);
      });
      panel.on('pointerout', () => {
        panel.setFillStyle(COLORS.panel);
      });
      panel.on('pointerdown', shelf.onPress);
    }
    container.add(panel);
    container.add(this.label(shelf.title, -CARD.height / 2 + 44, available));
    container.add(this.body(shelf.what, -CARD.height / 2 + 100, available));
    container.add(this.footer(shelf.blocked ?? shelf.cost, available));

    return container;
  }

  private label(text: string, y: number, available: boolean): Phaser.GameObjects.Text {
    return this.options.scene.add
      .text(0, y, text, {
        fontFamily: FONT,
        fontSize: TYPE.cardName,
        color: available ? PLAYER_INK : MUTED,
      })
      .setOrigin(0.5, 0.5);
  }

  private body(text: string, y: number, available: boolean): Phaser.GameObjects.Text {
    return this.options.scene.add
      .text(0, y, text, {
        fontFamily: FONT,
        fontSize: TYPE.slotIntent,
        color: available ? INK : MUTED,
        align: 'center',
        wordWrap: { width: CARD.width - 52 },
      })
      .setOrigin(0.5, 0);
  }

  private footer(text: string, available: boolean): Phaser.GameObjects.Text {
    return this.options.scene.add
      .text(0, CARD.height / 2 - 58, text, {
        fontFamily: FONT,
        fontSize: TYPE.slotIntent,
        color: available ? GUARD_INK : DANGER_INK,
        align: 'center',
        wordWrap: { width: CARD.width - 52 },
      })
      .setOrigin(0.5, 0.5);
  }
}

/** §9 prices three tiers; a Sigil is upgraded to, never sold. */
function isBuyable(tier: GemTier): boolean {
  return materialPrice(tier) !== null;
}

function materialShelf(run: RunState, tier: GemTier, onBuy: (tier: GemTier) => void): Shelf {
  const price = materialPrice(tier);
  const name = MATERIAL_NAMES[tier];

  return {
    title: name.toUpperCase(),
    what: `Crafts a tier-${String(tier)} gem at the forge. Higher tiers roll stronger numbers, and three of one become one of the next.`,
    cost: price === null ? '' : `${String(price)} gold`,
    blocked: price === null || run.gold >= price ? null : `you have ${String(run.gold)} gold`,
    onPress: () => {
      onBuy(tier);
    },
  };
}

function moveOn(onPress: () => void): Shelf {
  return {
    title: 'MOVE ON',
    what: 'Leave without spending. The Market was one of your two nodes this Depth either way.',
    cost: 'back to the map',
    blocked: null,
    onPress,
  };
}

function carriedLines(run: RunState): readonly string[] {
  const held = GEM_TIERS.map((tier) => `${MATERIAL_NAMES[tier]} ${String(run.materials[tier])}`);

  return [
    `${String(run.gold)} gold   ·   ${String(run.deck.length)} cards   ·   insight ${String(run.insight)}`,
    held.join('   '),
    'relics are not in yet — this Depth sells materials and thins the deck',
  ];
}

/**
 * The deck, one row per distinct card, with what removing it would cost.
 *
 * Repeats collapse into one row with a count: §5.1's deck holds three Jabs, and
 * three identical rows would be three ways to press the same button.
 */
function deckLines(run: RunState, arming: CardId | null): readonly string[] {
  const price = nextRemovalPrice(run);
  const distinct = distinctDeck(run);

  const rows = distinct.slice(0, DECK.rows).map((card, index) => {
    const copies = run.deck.filter((held) => held === card).length;
    const tail = copies > 1 ? `  ×${String(copies)}` : '';
    const marker = arming === card ? '▸' : ' ';
    const why = refusalFor(run, card, price);
    return `  ${marker} ${String(index + 1)}  ${card.padEnd(12)}${tail.padEnd(6)}${why}`;
  });

  const hidden = distinct.length - rows.length;
  const tail =
    hidden > 0 ? ['', `  ${String(hidden)} more in the deck, and no key left to reach them`] : [];

  return ['THIN THE DECK', `  ${headline(run, price)}`, '', ...rows, ...tail];
}

function headline(run: RunState, price: number | null): string {
  if (price === null) return 'you have used every removal a run allows';
  if (run.deck.length <= DECK_FLOOR) return `a deck of ${String(DECK_FLOOR)} is as thin as it goes`;
  return `press a number twice to remove that card — the next one costs ${String(price)} gold`;
}

/** Why this row cannot be pressed, or blank when it can. */
function refusalFor(run: RunState, card: CardId, price: number | null): string {
  if (card === SIGNATURE_CARD) return 'your signature — it carries the opening socket';
  if (price === null) return 'no removals left';
  if (run.deck.length <= DECK_FLOOR) return 'the deck is at its floor';
  if (run.gold < price) return `costs ${String(price)} gold`;
  return '';
}

function distinctDeck(run: RunState): readonly CardId[] {
  return [...new Set(run.deck)];
}

function keyOf(run: RunState, card: CardId): string {
  return String(distinctDeck(run).indexOf(card) + 1);
}
