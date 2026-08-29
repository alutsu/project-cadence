import Phaser from 'phaser';
import { m0Catalogue } from '../data/cards.ts';
import { ENCOUNTERS } from '../data/encounters.ts';
import type { Action } from '../sim/actions.ts';
import { isAlive } from '../sim/actor.ts';
import type { CardDefinition } from '../sim/card.ts';
import { advanceToDecision, reduce, startCombat } from '../sim/combat.ts';
import { previewAction } from '../sim/forecast.ts';
import { cardId, type ActorId } from '../sim/ids.ts';
import { createRng } from '../sim/rng.ts';
import { hasPlayableCard } from '../sim/piles.ts';
import { findActor, type CombatState } from '../sim/state.ts';
import { ActionBar } from '../ui/ActionBar.ts';
import { EncounterBanner } from '../ui/EncounterBanner.ts';
import { EnemyLine } from '../ui/EnemyLine.ts';
import { Hand } from '../ui/Hand.ts';
import { PilesPanel } from '../ui/PilesPanel.ts';
import { PreviewReadout } from '../ui/PreviewReadout.ts';
import { QueueStrip } from '../ui/QueueStrip.ts';
import { COLORS } from '../ui/theme.ts';

interface CombatViews {
  readonly queue: QueueStrip;
  readonly enemies: EnemyLine;
  readonly hand: Hand;
  readonly bar: ActionBar;
  readonly readout: PreviewReadout;
  readonly piles: PilesPanel;
  readonly banner: EncounterBanner;
}

/**
 * Wiring only (CLAUDE.md §6): build the encounter, connect the views to the
 * reducer, re-render on every committed action. No game rule lives here, and
 * nothing advances in `update` — the sim moves when a decision is made.
 *
 * S4 replaces the fixed hand with the real draw / Cooldown piles (GDD §4.9).
 */
export class CombatScene extends Phaser.Scene {
  private encounterIndex = 0;
  private state: CombatState = openingState(0);
  private target: ActorId | null = null;
  private views: CombatViews | null = null;
  private autoWait: Phaser.Time.TimerEvent | null = null;

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
        onHover: (card) => {
          this.previewCard(card);
        },
      }),
      bar: new ActionBar({
        scene: this,
        onWait: () => {
          this.commit({ kind: 'wait' });
        },
        onHoverWait: (hovering) => {
          this.previewWait(hovering);
        },
      }),
      readout: new PreviewReadout(this),
      piles: new PilesPanel(this),
      banner: new EncounterBanner(this),
    };

    // Once an encounter is over the cards are inert, so a click anywhere is
    // unambiguous: it means "next".
    this.input.on(Phaser.Input.Events.POINTER_DOWN, () => {
      this.advanceEncounter();
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.teardown();
    });
    this.renderAll();
  }

  /**
   * The ghost preview (GDD §4.2). Only the strip and the readout change — the
   * hand must not be rebuilt under the pointer that is hovering it.
   */
  private previewCard(card: CardDefinition | null): void {
    const target = this.currentTarget();
    if (card === null || target === null) {
      this.clearPreview();
      return;
    }
    this.showPreview({ kind: 'play', card: card.id, target }, card.name.toUpperCase());
  }

  private previewWait(hovering: boolean): void {
    if (hovering) {
      this.showPreview({ kind: 'wait' }, 'WAIT');
      return;
    }
    this.clearPreview();
  }

  private showPreview(action: Action, label: string): void {
    const views = this.views;
    if (views === null) return;

    const preview = previewAction(this.state, action);
    views.queue.render(this.state, preview);
    views.readout.render(label, preview);
  }

  private clearPreview(): void {
    const views = this.views;
    if (views === null) return;

    views.queue.render(this.state);
    views.readout.render('', null);
  }

  /** A cleared or lost encounter moves on to the next one in the set. */
  private advanceEncounter(): void {
    if (this.state.outcome === 'ongoing') return;

    this.encounterIndex = (this.encounterIndex + 1) % ENCOUNTERS.length;
    this.state = openingState(this.encounterIndex);
    this.target = firstLivingEnemy(this.state);
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

    const advanced = advanceToDecision(result.step.state);
    this.state = advanced.state;
    this.target = this.currentTarget();
    this.renderAll();

    for (const event of [...result.step.events, ...advanced.events]) {
      if (event.kind === 'staggered') this.views?.queue.flashStagger(event.actor, event.delay);
    }
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
    views.readout.render('', null);
    views.piles.render(this.state);
    views.banner.render(
      encounterAt(this.encounterIndex).name,
      encounterAt(this.encounterIndex).teaches,
      this.state.outcome === 'ongoing'
        ? ''
        : `${outcomeWord(this.state.outcome)} — click to continue`,
    );
    this.armAutoWait();
  }

  /**
   * GDD §4.3: with no card that can be played, Wait is taken for the player
   * after a beat. The pause is deliberate — it reads as the character hesitating
   * rather than as the game skipping the turn.
   */
  private armAutoWait(): void {
    this.autoWait?.remove();
    this.autoWait = null;

    const idle =
      this.state.outcome === 'ongoing' &&
      this.state.activeActorId !== null &&
      !hasPlayableCard(this.state.hand, this.state.catalogue);
    if (!idle) return;

    this.autoWait = this.time.delayedCall(AUTO_WAIT_DELAY_MS, () => {
      this.commit({ kind: 'wait' });
    });
  }

  private teardown(): void {
    const views = this.views;
    if (views === null) return;

    views.queue.destroy();
    views.enemies.destroy();
    views.hand.destroy();
    views.bar.destroy();
    views.readout.destroy();
    views.piles.destroy();
    views.banner.destroy();
    this.input.removeAllListeners();
    this.autoWait?.remove();
    this.autoWait = null;
    this.views = null;
  }
}

/** GDD §4.3: the beat before Wait is taken for the player. */
const AUTO_WAIT_DELAY_MS = 1500;

function encounterAt(index: number): (typeof ENCOUNTERS)[number] {
  const encounter = ENCOUNTERS[index % ENCOUNTERS.length];
  if (encounter === undefined) throw new Error('the encounter set is empty');
  return encounter;
}

function outcomeWord(outcome: CombatState['outcome']): string {
  return outcome === 'won' ? 'cleared' : 'you died';
}

function openingState(index: number): CombatState {
  const catalogue = m0Catalogue();
  const started = startCombat({
    actors: encounterAt(index).actors,
    catalogue,
    deck: Object.keys(catalogue).map(cardId),
    // M0 has no run seed yet; the map and gem streams arrive with the run layer.
    rng: createRng(Date.now(), 'combat'),
  });
  return advanceToDecision(started.state).state;
}

function firstLivingEnemy(state: CombatState): ActorId | null {
  return state.actors.find((actor) => actor.side === 'enemy' && isAlive(actor))?.id ?? null;
}
