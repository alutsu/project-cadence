import Phaser from 'phaser';
import { m0Catalogue } from '../data/cards.ts';
import { ratAndWarden } from '../data/encounters.ts';
import type { Action } from '../sim/actions.ts';
import { isAlive } from '../sim/actor.ts';
import type { CardDefinition } from '../sim/card.ts';
import { advanceToDecision, reduce, startCombat } from '../sim/combat.ts';
import { cardId, type ActorId } from '../sim/ids.ts';
import { findActor, type CombatState } from '../sim/state.ts';
import { ActionBar } from '../ui/ActionBar.ts';
import { EnemyLine } from '../ui/EnemyLine.ts';
import { Hand } from '../ui/Hand.ts';
import { QueueStrip } from '../ui/QueueStrip.ts';
import { COLORS } from '../ui/theme.ts';

interface CombatViews {
  readonly queue: QueueStrip;
  readonly enemies: EnemyLine;
  readonly hand: Hand;
  readonly bar: ActionBar;
}

/**
 * Wiring only (CLAUDE.md §6): build the encounter, connect the views to the
 * reducer, re-render on every committed action. No game rule lives here, and
 * nothing advances in `update` — the sim moves when a decision is made.
 *
 * S4 replaces the fixed hand with the real draw / Cooldown piles (GDD §4.9).
 */
export class CombatScene extends Phaser.Scene {
  private state: CombatState = openingState();
  private target: ActorId | null = null;
  private views: CombatViews | null = null;

  constructor() {
    super('Combat');
  }

  create(): void {
    this.cameras.main.setBackgroundColor(COLORS.background);
    this.target = firstLivingEnemy(this.state);

    this.views = {
      queue: new QueueStrip(this),
      enemies: new EnemyLine({
        scene: this,
        onTarget: (actor) => {
          this.selectTarget(actor);
        },
      }),
      hand: new Hand({
        scene: this,
        onPlay: (card) => {
          this.playCard(card);
        },
      }),
      bar: new ActionBar({
        scene: this,
        onWait: () => {
          this.commit({ kind: 'wait' });
        },
      }),
    };

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.teardown();
    });
    this.renderAll();
  }

  private selectTarget(actor: ActorId): void {
    this.target = actor;
    this.renderAll();
  }

  private playCard(card: CardDefinition): void {
    const target = this.currentTarget();
    if (target === null) return;
    this.commit({ kind: 'play', card: card.id, target });
  }

  /**
   * Illegal actions are refused by the reducer, not by the view — the UI simply
   * declines to re-render when its request is rejected (CLAUDE.md §5.4).
   */
  private commit(action: Action): void {
    const result = reduce(this.state, action);
    if (!result.ok) return;

    this.state = advanceToDecision(result.step.state).state;
    this.target = this.currentTarget();
    this.renderAll();
  }

  /** GDD §4.8: the target persists, and killing it advances to the next enemy. */
  private currentTarget(): ActorId | null {
    const held = this.target;
    if (held !== null) {
      const actor = findActor(this.state, held);
      if (actor !== undefined && isAlive(actor)) return held;
    }
    return firstLivingEnemy(this.state);
  }

  private renderAll(): void {
    const views = this.views;
    if (views === null) return;

    views.queue.render(this.state);
    views.enemies.render(this.state, this.target);
    views.hand.render(this.state);
    views.bar.render(this.state);
  }

  private teardown(): void {
    const views = this.views;
    if (views === null) return;

    views.queue.destroy();
    views.enemies.destroy();
    views.hand.destroy();
    views.bar.destroy();
    this.views = null;
  }
}

/** The M0 hand: six cards, fixed. The piles that would refill it arrive in S4. */
const M0_HAND = ['strike', 'lunge', 'cleave', 'hammerfall', 'crush', 'cataclysm'].map(cardId);

function openingState(): CombatState {
  const started = startCombat({
    actors: ratAndWarden(),
    catalogue: m0Catalogue(),
    hand: M0_HAND,
  });
  return advanceToDecision(started.state).state;
}

function firstLivingEnemy(state: CombatState): ActorId | null {
  return state.actors.find((actor) => actor.side === 'enemy' && isAlive(actor))?.id ?? null;
}
