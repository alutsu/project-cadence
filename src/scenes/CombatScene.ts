import Phaser from 'phaser';
import { m0Catalogue } from '../data/cards.ts';
import { ENCOUNTERS, PLAYER } from '../data/encounters.ts';
import type { Action } from '../sim/actions.ts';
import { isAlive } from '../sim/actor.ts';
import type { CardDefinition } from '../sim/card.ts';
import { advanceToDecision, reduce, startCombat } from '../sim/combat.ts';
import { previewAction } from '../sim/forecast.ts';
import { cardId, type ActorId } from '../sim/ids.ts';
import { createRng } from '../sim/rng.ts';
import { DEFAULT_RULES, ULTIMATE_RULES, type CombatRules } from '../sim/rules.ts';
import { tick } from '../sim/tick.ts';
import { hasPlayableCard } from '../sim/piles.ts';
import { findActor, type CombatState } from '../sim/state.ts';
import { ActionBar } from '../ui/ActionBar.ts';
import { EncounterBanner } from '../ui/EncounterBanner.ts';
import { EnemyLine } from '../ui/EnemyLine.ts';
import { Hand } from '../ui/Hand.ts';
import { PilesPanel } from '../ui/PilesPanel.ts';
import { PreviewReadout } from '../ui/PreviewReadout.ts';
import { SessionLog } from '../ui/SessionLog.ts';
import { TuningPanel } from '../ui/TuningPanel.ts';
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
  readonly tuning: TuningPanel;
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
  private rules: CombatRules = DEFAULT_RULES;
  private animations = true;
  private readonly session = new SessionLog();
  private state: CombatState = openingState(0, DEFAULT_RULES);
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
      tuning: new TuningPanel(this),
    };

    this.installTuningKeys();

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
    this.restart();
  }

  /**
   * The feel pass needs the numbers GDD §22 calls guesses to move while playing,
   * not between builds. Every change restarts the encounter, because rules live
   * in state and a half-changed encounter would not be a fair reading.
   */
  private installTuningKeys(): void {
    const keys = this.input.keyboard;
    if (keys === null) return;

    keys.on('keydown-T', () => {
      this.views?.tuning.toggle();
      this.renderAll();
    });
    keys.on('keydown-U', () => {
      this.cycleUltimateRule();
    });
    keys.on('keydown-G', () => {
      this.retune({ guardCap: Math.max(5, this.rules.guardCap - 5) });
    });
    keys.on('keydown-H', () => {
      this.retune({ guardCap: this.rules.guardCap + 5 });
    });
    keys.on('keydown-J', () => {
      this.retune({ guardDecayPerTick: Math.max(0, this.rules.guardDecayPerTick - 1) });
    });
    keys.on('keydown-K', () => {
      this.retune({ guardDecayPerTick: this.rules.guardDecayPerTick + 1 });
    });
    keys.on('keydown-W', () => {
      this.retune({ waitWeight: tick(this.rules.waitWeight >= 6 ? 2 : this.rules.waitWeight + 1) });
    });
    keys.on('keydown-A', () => {
      this.animations = !this.animations;
      this.renderAll();
    });
    keys.on('keydown-R', () => {
      this.restart();
    });
    keys.on('keydown-N', () => {
      this.encounterIndex = (this.encounterIndex + 1) % ENCOUNTERS.length;
      this.restart();
    });
  }

  private cycleUltimateRule(): void {
    const at = ULTIMATE_RULES.indexOf(this.rules.ultimate);
    this.retune({ ultimate: ULTIMATE_RULES[(at + 1) % ULTIMATE_RULES.length] ?? 'immediate' });
  }

  private retune(change: Partial<CombatRules>): void {
    this.rules = { ...this.rules, ...change };
    this.restart();
  }

  private restart(): void {
    this.state = openingState(this.encounterIndex, this.rules);
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
    const events = [...result.step.events, ...advanced.events];
    const wasOngoing = this.state.outcome === 'ongoing';

    this.state = advanced.state;
    this.target = this.currentTarget();
    this.session.record(events, PLAYER);
    if (wasOngoing && this.state.outcome !== 'ongoing') this.session.encounterFinished();
    this.renderAll();

    // Animations never change a result — they only show one (GDD §15).
    if (!this.animations) return;
    for (const event of events) {
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
      `${encounterAt(this.encounterIndex).teaches}   ·   seed ${String(SESSION_SEED)}`,
      this.state.outcome === 'ongoing' ? '' : this.endOfEncounterSummary(),
    );
    views.tuning.render(this.rules, this.animations);
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

  /** What the gate's questions need, counted rather than remembered (§7). */
  private endOfEncounterSummary(): string {
    const totals = this.session.totals(Object.keys(this.state.catalogue).map(cardId));
    const played = `${String(totals.cardsPlayed)} cards · ${String(totals.waits)} waits`;
    const fought = `${String(totals.staggers)} staggers · ${String(totals.damageTaken)} taken`;
    const unplayed =
      totals.neverPlayed.length === 0
        ? 'every card played'
        : `never played: ${totals.neverPlayed.join(', ')}`;

    return [
      `${outcomeWord(this.state.outcome)} — click to continue`,
      `${played} · ${fought}`,
      unplayed,
    ].join('\n');
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
    views.tuning.destroy();
    this.input.removeAllListeners();
    this.input.keyboard?.removeAllListeners();
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

/**
 * The session seed. Taken from `?seed=` when present so a fight can be replayed
 * exactly — GDD §13 wants that for run summaries, and the M0 gate wants it so a
 * tester can report the hand they were looking at.
 */
const SESSION_SEED = readSeed();

function readSeed(): number {
  const requested = new URLSearchParams(window.location.search).get('seed');
  const parsed = requested === null ? Number.NaN : Number(requested);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function openingState(index: number, rules: CombatRules): CombatState {
  const catalogue = m0Catalogue();
  const started = startCombat({
    actors: encounterAt(index).actors,
    catalogue,
    deck: Object.keys(catalogue).map(cardId),
    // One stream in M0; the map and gem streams arrive with the run layer.
    rng: createRng(SESSION_SEED + index, 'combat'),
    rules,
  });
  return advanceToDecision(started.state).state;
}

function firstLivingEnemy(state: CombatState): ActorId | null {
  return state.actors.find((actor) => actor.side === 'enemy' && isAlive(actor))?.id ?? null;
}
