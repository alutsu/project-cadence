import Phaser from 'phaser';
import type { MapNode } from '../run/map.ts';
import { maxHpFloor, type RunState } from '../run/RunState.ts';
import { DEPTH_COUNT, NODES_TAKEN_PER_DEPTH } from '../run/map.ts';
import type { NodeId } from '../sim/ids.ts';
import { TAG_GLYPHS } from '../sim/tag.ts';
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
 * The map, drawn (GDD §11).
 *
 * > Each offers 2 Dungeons, 1 Sanctum, 1 Market; the player takes **2 nodes**,
 * > then the Boss. The node types pay in **different currencies** (XP vs. HP
 * > vs. gold), so they can't be ranked against each other.
 *
 * So the card for each node states what it *pays* rather than a score, and
 * every number on it is read from the run (CLAUDE.md §2.1). A Dungeon shows its
 * Threat rating and one Omen and nothing else, because §11's whole point is
 * commitment before information — what is actually inside is not known here,
 * and the view could not print it if it wanted to.
 */

export interface OfferedNode {
  readonly node: MapNode;
  /** The enemy level this node will field, from the run (§5.3). */
  readonly level: number;
}

export interface MapViewState {
  readonly run: RunState;
  readonly depth: number;
  readonly offered: readonly OfferedNode[];
}

export interface MapViewOptions {
  readonly scene: Phaser.Scene;
  readonly onEnter: (node: NodeId) => void;
}

/** Where a node's card sits. Exported so a test can find one without Phaser. */
export function nodeSeat(index: number, count: number): { readonly x: number; readonly y: number } {
  const { cardWidth, gap } = LAYOUT.map;
  const fromCentre = index - (count - 1) / 2;
  return { x: LAYOUT.width / 2 + fromCentre * (cardWidth + gap), y: LAYOUT.map.centreY };
}

/** What a node pays, in its own currency (§11). Not a difficulty score. */
export function nodeLines(offered: OfferedNode): readonly string[] {
  const { node, level } = offered;

  if (node.kind === 'sanctum') return ['pays HP', 'rest to full', 'costs you the node'];
  if (node.kind === 'market') return ['spend gold', 'materials, or', 'thin the deck'];
  if (node.kind === 'boss') {
    return ['pays the Depth', `enemy level ${String(level)}`, 'the way onward'];
  }

  const omen = node.omen;
  return [
    'pays XP',
    `${String(node.encounters)} fights · enemy level ${String(level)}`,
    omen === null ? 'no omen' : `omen: ${TAG_GLYPHS[omen.tag]} ${omen.kind} ${omen.tag}`,
  ];
}

const TITLES: Readonly<Record<MapNode['kind'], string>> = {
  dungeon: 'DUNGEON',
  sanctum: 'SANCTUM',
  market: 'MARKET',
  boss: 'BOSS',
};

export class MapView {
  private readonly options: MapViewOptions;
  private readonly heading: Phaser.GameObjects.Text;
  private readonly purse: Phaser.GameObjects.Text;
  private cards: Phaser.GameObjects.Container[] = [];

  constructor(options: MapViewOptions) {
    this.options = options;
    const { scene } = options;

    this.heading = scene.add
      .text(LAYOUT.width / 2, LAYOUT.map.headingY, '', {
        fontFamily: FONT,
        fontSize: TYPE.hud,
        color: INK,
        align: 'center',
      })
      .setOrigin(0.5, 0.5);
    this.purse = scene.add
      .text(LAYOUT.width / 2, LAYOUT.map.purseY, '', {
        fontFamily: FONT,
        fontSize: TYPE.slotIntent,
        color: MUTED,
        align: 'center',
      })
      .setOrigin(0.5, 0.5);
  }

  render(state: MapViewState): void {
    this.clear();

    const taken = state.run.position.taken.length;
    const left = NODES_TAKEN_PER_DEPTH - taken;
    this.heading.setText(
      `DEPTH ${String(state.depth)} OF ${String(DEPTH_COUNT)}\n` +
        (left > 0
          ? `take ${String(left)} more node${left === 1 ? '' : 's'}, then the Boss`
          : 'the Boss waits'),
    );
    this.purse.setText(purseLine(state.run));

    this.cards = state.offered.map((offered, index) =>
      this.card(offered, nodeSeat(index, state.offered.length)),
    );
  }

  destroy(): void {
    this.clear();
    this.heading.destroy();
    this.purse.destroy();
  }

  private clear(): void {
    for (const card of this.cards) card.destroy(true);
    this.cards = [];
  }

  private card(
    offered: OfferedNode,
    seat: { readonly x: number; readonly y: number },
  ): Phaser.GameObjects.Container {
    const { scene } = this.options;
    const { cardWidth, cardHeight } = LAYOUT.map;
    const container = scene.add.container(seat.x, seat.y);

    const panel = scene.add
      .rectangle(0, 0, cardWidth, cardHeight, COLORS.panel)
      .setStrokeStyle(2, edgeOf(offered.node));
    panel.setInteractive({ useHandCursor: true });
    panel.on('pointerover', () => {
      panel.setFillStyle(COLORS.panelActive);
    });
    panel.on('pointerout', () => {
      panel.setFillStyle(COLORS.panel);
    });
    panel.on('pointerdown', () => {
      this.options.onEnter(offered.node.id);
    });
    container.add(panel);

    container.add(
      scene.add
        .text(0, -cardHeight / 2 + 44, titleOf(offered.node), {
          fontFamily: FONT,
          fontSize: TYPE.cardName,
          color: inkOf(offered.node),
        })
        .setOrigin(0.5, 0.5),
    );

    for (const [line, text] of nodeLines(offered).entries()) {
      container.add(
        scene.add
          .text(0, -cardHeight / 2 + 110 + line * LAYOUT.map.lineHeight, text, {
            fontFamily: FONT,
            fontSize: TYPE.slotIntent,
            color: line === 0 ? PLAYER_INK : MUTED,
            align: 'center',
            wordWrap: { width: cardWidth - 40 },
          })
          .setOrigin(0.5, 0),
      );
    }

    return container;
  }
}

function titleOf(node: MapNode): string {
  return node.elite ? `ELITE ${TITLES[node.kind]}` : TITLES[node.kind];
}

function edgeOf(node: MapNode): number {
  if (node.kind === 'boss') return COLORS.danger;
  if (node.elite) return COLORS.enemy;
  return node.kind === 'dungeon' ? COLORS.panelEdge : COLORS.guard;
}

function inkOf(node: MapNode): string {
  if (node.kind === 'boss') return DANGER_INK;
  return node.kind === 'dungeon' ? INK : GUARD_INK;
}

/** What the run is carrying, since a node's worth depends on it (§11). */
function purseLine(run: RunState): string {
  return (
    `level ${String(run.level)} · ${String(run.deck.length)} cards · ` +
    `${String(run.hp)}/${String(run.maxHp)} HP (floor ${String(maxHpFloor(run))}) · ` +
    `threat ${String(run.threat)} · insight ${String(run.insight)}`
  );
}
