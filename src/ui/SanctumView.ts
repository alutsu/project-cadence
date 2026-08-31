import Phaser from 'phaser';
import { canOpenAnySocket, maxHpFloor, missingHp, type RunState } from '../run/RunState.ts';
import { MATERIAL_NAMES } from '../run/materials.ts';
import { GEM_TIERS } from '../sim/gem.ts';
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
 * The Sanctum (GDD §11, §15.2).
 *
 * A playtester read this screen and understood none of it, which is a P5
 * failure and not a missing feature. What it said was true and told you nothing
 * you could act on: a Max HP floor with no explanation of what a floor is, four
 * material names all reading zero with no hint of where materials come from, a
 * forge button that opened a forge which could not forge, and a GDD section
 * number printed on the screen.
 *
 * Every act now states three things in the order a player needs them: **what it
 * does**, **what it costs**, and — when it is unavailable — **why**. A greyed
 * button that does not say why is a puzzle about the interface rather than
 * about the game.
 */

export interface SanctumOptions {
  readonly scene: Phaser.Scene;
  readonly onRest: () => void;
  readonly onForge: () => void;
  readonly onLeave: () => void;
}

interface Act {
  readonly title: string;
  readonly what: string;
  readonly cost: string;
  /** Null when the act can be taken; otherwise the reason it cannot. */
  readonly blocked: string | null;
  readonly onPress: () => void;
}

const CARD = { width: 400, height: 300, gap: 48, y: 680 } as const;

export class SanctumView {
  private readonly options: SanctumOptions;
  private readonly heading: Phaser.GameObjects.Text;
  private readonly carried: Phaser.GameObjects.Text;
  private cards: Phaser.GameObjects.Container[] = [];

  constructor(options: SanctumOptions) {
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
      .text(LAYOUT.width / 2, 330, '', {
        fontFamily: FONT,
        fontSize: TYPE.slotName,
        color: MUTED,
        align: 'center',
        lineSpacing: 10,
      })
      .setOrigin(0.5, 0);
  }

  render(run: RunState): void {
    this.clear();

    this.heading.setText('THE SANCTUM\nno fight here — spend the stop, then move on');
    this.carried.setText(carriedLines(run).join('\n'));

    const acts = [
      restAct(run, this.options.onRest),
      forgeAct(run, this.options.onForge),
      moveOn(this.options.onLeave),
    ];
    this.cards = acts.map((act, index) => this.card(act, index, acts.length));
  }

  destroy(): void {
    this.clear();
    this.heading.destroy();
    this.carried.destroy();
  }

  private clear(): void {
    for (const card of this.cards) card.destroy(true);
    this.cards = [];
  }

  private card(act: Act, index: number, count: number): Phaser.GameObjects.Container {
    const { scene } = this.options;
    const available = act.blocked === null;
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
      panel.on('pointerdown', act.onPress);
    }
    container.add(panel);

    container.add(
      scene.add
        .text(0, -CARD.height / 2 + 46, act.title, {
          fontFamily: FONT,
          fontSize: TYPE.cardName,
          color: available ? PLAYER_INK : MUTED,
        })
        .setOrigin(0.5, 0.5),
    );
    container.add(
      scene.add
        .text(0, -CARD.height / 2 + 106, act.what, {
          fontFamily: FONT,
          fontSize: TYPE.slotIntent,
          color: available ? INK : MUTED,
          align: 'center',
          wordWrap: { width: CARD.width - 56 },
        })
        .setOrigin(0.5, 0),
    );
    container.add(
      scene.add
        .text(0, CARD.height / 2 - 62, act.blocked ?? act.cost, {
          fontFamily: FONT,
          fontSize: TYPE.slotIntent,
          color: available ? GUARD_INK : DANGER_INK,
          align: 'center',
          wordWrap: { width: CARD.width - 56 },
        })
        .setOrigin(0.5, 0.5),
    );

    return container;
  }
}

function restAct(run: RunState, onPress: () => void): Act {
  const missing = missingHp(run);
  return {
    title: 'REST',
    what: 'Heal to full. Nothing else in a run restores health — a wound carries from fight to fight until you spend a stop on it.',
    cost: `heals ${String(missing)} HP`,
    blocked: missing > 0 ? null : 'you are already at full health',
    onPress,
  };
}

function forgeAct(run: RunState, onPress: () => void): Act {
  const materials = GEM_TIERS.reduce((total, tier) => total + run.materials[tier], 0);
  // Asked of the run, not worked out here: §6.1's floor and its costs are rules,
  // and a view that re-derived them could disagree with the forge that applies
  // them (CLAUDE.md §2.1, and the guard that enforces it caught me doing so).
  const openable = canOpenAnySocket(run);

  return {
    title: 'THE FORGE',
    what: 'Open a socket on a card, and craft a gem to put in it. Sockets are paid for in maximum health, permanently. Gems are rolled, not chosen.',
    // What you could do here, not what it would cost — the cost depends on
    // which card you pick, and the forge itself states it per card.
    cost: openable
      ? `${String(materials)} material${materials === 1 ? '' : 's'} to craft with`
      : `${String(materials)} material${materials === 1 ? '' : 's'} · ${String(run.insight)} insight`,
    blocked:
      materials > 0 || openable
        ? null
        : 'nothing to work with — materials come from winning fights',
    onPress,
  };
}

function moveOn(onPress: () => void): Act {
  return {
    title: 'MOVE ON',
    what: 'Leave without spending the stop. The Sanctum was one of your two nodes this Depth either way.',
    cost: 'back to the map',
    blocked: null,
    onPress,
  };
}

/**
 * What the run is carrying. The Max HP floor is stated as the thing it is — a
 * limit on how much health the forge may ever cost you — rather than as a bare
 * number the player has to work out the meaning of.
 */
function carriedLines(run: RunState): readonly string[] {
  const held = GEM_TIERS.map((tier) => `${MATERIAL_NAMES[tier]} ${String(run.materials[tier])}`);

  return [
    `${String(run.hp)} of ${String(run.maxHp)} health   ·   level ${String(run.level)}   ·   ${String(run.deck.length)} cards`,
    `${held.join('   ')}   ·   insight ${String(run.insight)}`,
    `the forge may never take your maximum below ${String(maxHpFloor(run))}`,
  ];
}
