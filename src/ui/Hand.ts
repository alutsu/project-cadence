import Phaser from 'phaser';
import type { CardDefinition } from '../sim/card.ts';
import { findCard } from '../sim/card.ts';
import { playerActor, type CombatState } from '../sim/state.ts';
import { actorDelay } from '../sim/actor.ts';
import type { ActorId } from '../sim/ids.ts';
import { resolvedWeight } from '../sim/resolve.ts';
import { damageAgainst } from '../sim/strike.ts';
import { CardFace } from './CardFace.ts';
import { LAYOUT } from './theme.ts';

export interface HandOptions {
  readonly scene: Phaser.Scene;
  readonly onPlay: (card: CardDefinition) => void;
  readonly onHover: (card: CardDefinition | null) => void;
}

/**
 * The hand, held in the player's own hands along the bottom of the frame
 * (GDD §15.1). The tilt and lift are the whole "first person" trick — cards fan
 * from a point below the screen, as if looked down at.
 */
export interface HandSeat {
  readonly index: number;
  readonly count: number;
}

/**
 * Where the nth card of a hand sits. Exported because the strike animation has
 * to leave from the card the player actually clicked — if it computed its own
 * position the two would drift apart the moment the fan changes.
 */
export function handSeat({ index, count }: HandSeat): { readonly x: number; readonly y: number } {
  const { cardWidth, gap, baselineY, lift } = LAYOUT.hand;
  const fromCenter = index - (count - 1) / 2;
  return {
    x: LAYOUT.width / 2 + fromCenter * (cardWidth + gap),
    y: baselineY + Math.abs(fromCenter) * lift,
  };
}

export class Hand {
  private readonly options: HandOptions;
  private faces: CardFace[] = [];

  constructor(options: HandOptions) {
    this.options = options;
  }

  render(state: CombatState, target: ActorId | null): void {
    this.clear();

    const cards = state.hand
      .map((id) => findCard(state.catalogue, id))
      .filter((card): card is CardDefinition => card !== undefined);

    const { tiltDegrees } = LAYOUT.hand;
    const middle = (cards.length - 1) / 2;

    // Both figures on a card face are asked of the sim, never worked out here
    // (CLAUDE.md §2.1): the Weight carries §7.1's rider and the damage carries
    // the target's resistance, and neither is the number printed on the card.
    const player = playerActor(state);

    this.faces = cards.map((card, index) => {
      const face = new CardFace({
        scene: this.options.scene,
        card,
        delay:
          player === undefined
            ? resolvedWeight(state.weave, card)
            : actorDelay(player, resolvedWeight(state.weave, card)),
        damage: damageAgainst(state, card, target),
        onPlay: this.options.onPlay,
        onHover: this.options.onHover,
      });
      const seat = handSeat({ index, count: cards.length });
      face.view.setPosition(seat.x, seat.y);
      face.view.setAngle((index - middle) * tiltDegrees);
      return face;
    });
  }

  /** Puts the cards down. A finished encounter has nothing left to play. */
  hide(): void {
    this.clear();
  }

  destroy(): void {
    this.clear();
  }

  private clear(): void {
    for (const face of this.faces) face.destroy();
    this.faces = [];
  }
}
