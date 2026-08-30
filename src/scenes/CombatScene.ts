import Phaser from 'phaser';
import { m0Catalogue } from '../data/cards.ts';
import { CHAIN_SIZE, ENCOUNTERS, PLAYER, PLAYER_MAX_HP, startsChain } from '../data/encounters.ts';
import type { Action } from '../sim/actions.ts';
import { isAlive } from '../sim/actor.ts';
import type { CardDefinition } from '../sim/card.ts';
import { advanceToDecision, reduce, startCombat } from '../sim/combat.ts';
import { previewAction } from '../sim/forecast.ts';
import { cardId, type ActorId, type CardId } from '../sim/ids.ts';
import { createRng } from '../sim/rng.ts';
import { DEFAULT_RULES, ULTIMATE_RULES, type CombatRules } from '../sim/rules.ts';
import { tick } from '../sim/tick.ts';
import { hasPlayableCard } from '../sim/piles.ts';
import { findActor, type CombatState } from '../sim/state.ts';
import { findCard } from '../sim/card.ts';
import type { CombatEvent } from '../sim/events.ts';
import { ActionBar } from '../ui/ActionBar.ts';
import { CombatFx } from '../ui/CombatFx.ts';
import { DeathScreen, type DeathReport } from '../ui/DeathScreen.ts';
import { EncounterBanner } from '../ui/EncounterBanner.ts';
import { EnemyLine, enemySeat } from '../ui/EnemyLine.ts';
import { Hand, handSeat } from '../ui/Hand.ts';
import { PilesPanel } from '../ui/PilesPanel.ts';
import { PreviewReadout } from '../ui/PreviewReadout.ts';
import { SessionLog } from '../ui/SessionLog.ts';
import { Sfx } from '../ui/Sfx.ts';
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
  readonly death: DeathScreen;
  readonly fx: CombatFx;
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
  /** HP the current encounter was entered on — GDD §4.10, carried between fights. */
  private enteringHp = PLAYER_MAX_HP;
  private rules: CombatRules = DEFAULT_RULES;
  private animations = true;
  private readonly session = new SessionLog();
  private readonly sfx = new Sfx();
  private state: CombatState = openingState({ index: 0, rules: DEFAULT_RULES, hp: PLAYER_MAX_HP });
  private target: ActorId | null = null;
  private views: CombatViews | null = null;
  private autoWait: Phaser.Time.TimerEvent | null = null;
  /**
   * Whether a click may dismiss a finished encounter. The click that lands the
   * killing blow must not also clear the screen reporting it — pointer-down
   * plays the card, the outcome changes inside that same event, and the global
   * handler would then advance on the very press that caused the death. Armed
   * on release, so dismissing always takes a second, deliberate click.
   */
  private dismissArmed = false;

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
      // Transient hits sit above the board and below the death screen.
      fx: new CombatFx(this),
      // Built last so it draws over everything it covers.
      death: new DeathScreen(this),
    };

    this.installTuningKeys();

    // Once an encounter is over the cards are inert, so a click anywhere is
    // unambiguous: it means "next".
    this.input.on(Phaser.Input.Events.POINTER_DOWN, () => {
      // Browsers only hand over an audio context inside a real gesture.
      this.sfx.unlock();
      if (!this.dismissArmed) return;
      this.advanceEncounter();
    });
    this.input.on(Phaser.Input.Events.POINTER_UP, () => {
      this.dismissArmed = this.state.outcome !== 'ongoing';
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

  /**
   * A cleared encounter carries its wound into the next one (GDD §4.10); dying
   * sends you back to the first, whole. The chain boundary restores HP — see
   * CHAIN_SIZE in the encounter data for why M0 needs one at all.
   */
  private advanceEncounter(): void {
    if (this.state.outcome === 'ongoing') return;

    if (this.state.outcome === 'lost') {
      this.encounterIndex = 0;
      this.enteringHp = PLAYER_MAX_HP;
      // The death screen has been read by now; the next attempt counts fresh.
      this.session.reset();
      this.restart();
      return;
    }

    this.encounterIndex = (this.encounterIndex + 1) % ENCOUNTERS.length;
    const survivingHp = findActor(this.state, PLAYER)?.hp ?? PLAYER_MAX_HP;
    this.enteringHp = startsChain(this.encounterIndex) ? PLAYER_MAX_HP : survivingHp;
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
    keys.on('keydown-S', () => {
      this.sfx.setMuted(!this.sfx.isMuted());
      this.renderAll();
    });
    keys.on('keydown-R', () => {
      this.restart();
    });
    keys.on('keydown-N', () => {
      // A debug jump, not a cleared fight: enter the next encounter whole, so
      // it can be read on its own terms.
      this.encounterIndex = (this.encounterIndex + 1) % ENCOUNTERS.length;
      this.enteringHp = PLAYER_MAX_HP;
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
    this.dismissArmed = false;
    this.state = openingState({
      index: this.encounterIndex,
      rules: this.rules,
      hp: this.enteringHp,
    });
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

    const before = this.state;
    const advanced = advanceToDecision(result.step.state);
    const events = [...result.step.events, ...advanced.events];
    const wasOngoing = this.state.outcome === 'ongoing';

    this.state = advanced.state;
    this.target = this.currentTarget();
    this.session.record(events, PLAYER);
    if (wasOngoing && this.state.outcome !== 'ongoing') {
      this.session.encounterFinished();
      this.dismissArmed = false;
    }
    this.renderAll();

    this.playFx(before, events);
  }

  /**
   * Sound and motion for what has already happened. Every value here is read
   * out of the event log after the reducer ran, so nothing this method does can
   * change an outcome — which is what makes skipping it safe (GDD §15).
   *
   * Seats come from the state *before* the action: a killed enemy has already
   * left the line by now, and its blow should still land where it stood.
   */
  private playFx(before: CombatState, events: readonly CombatEvent[]): void {
    const views = this.views;
    if (views === null) return;

    const died = new Set(
      events.filter((event) => event.kind === 'actor_died').map((event) => event.actor),
    );

    for (const event of events) {
      if (event.kind === 'card_played' && event.actor === PLAYER) {
        this.playedCardFx(before, event.card);
        continue;
      }
      if (event.kind === 'waited') {
        this.sfx.guard();
        continue;
      }
      if (event.kind === 'damage_dealt') {
        this.sfx.impact(event.amount);
        this.landedBlowFx(before, {
          target: event.target,
          amount: event.amount,
          lethal: died.has(event.target),
        });
        continue;
      }
      if (event.kind === 'staggered') {
        this.staggerFx(event.actor, event.delay);
        continue;
      }
      if (event.kind === 'actor_died') this.sfx.death();
    }
  }

  private staggerFx(actor: ActorId, delay: number): void {
    this.sfx.stagger();
    if (this.animations) this.views?.queue.flashStagger(actor, delay);
  }

  private playedCardFx(before: CombatState, card: CardId): void {
    const definition = findCard(before.catalogue, card);
    if (definition === undefined) return;
    this.sfx.strike(definition.weightClass);

    const index = before.hand.indexOf(card);
    const target = this.target;
    if (!this.animations || index === -1 || target === null) return;

    const to = enemySeat(before, target);
    if (to === null) return;
    this.views?.fx.strike({
      from: handSeat({ index, count: before.hand.length }),
      to,
      name: definition.name.toUpperCase(),
    });
  }

  private landedBlowFx(before: CombatState, blow: LandedBlow): void {
    if (!this.animations) return;

    const at = enemySeat(before, blow.target);
    // The player has no silhouette to hang a figure on (GDD §15.1), so an
    // incoming blow is heard rather than drawn.
    if (at === null) return;

    this.views?.fx.impact({ at, amount: blow.amount, lethal: blow.lethal });
    this.views?.enemies.flashHit(blow.target);
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

    const over = this.state.outcome !== 'ongoing';
    views.queue.render(this.state);
    views.enemies.render(this.state, this.target);
    // The cards are inert once the fight is over, and the summary needs the
    // room they occupy.
    if (over) views.hand.hide();
    else views.hand.render(this.state);
    views.bar.render(this.state);
    if (over) views.readout.hide();
    else views.readout.render('', null);
    views.piles.render(this.state);
    views.banner.render(
      encounterAt(this.encounterIndex).name,
      `${encounterAt(this.encounterIndex).teaches}   ·   ${this.chainLabel()}   ·   seed ${String(SESSION_SEED)}`,
      this.state.outcome === 'won' ? this.endOfEncounterSummary() : '',
    );
    views.tuning.render(this.rules, { animations: this.animations, sound: !this.sfx.isMuted() });
    if (this.state.outcome === 'lost') views.death.show(this.deathReport());
    else views.death.hide();
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
  /**
   * P3/P5: HP carrying between fights is only a real cost if the player can see
   * it coming. The label names the chain and where the next restore is.
   */
  private chainLabel(): string {
    const position = (this.encounterIndex % CHAIN_SIZE) + 1;
    const remaining = CHAIN_SIZE - position;
    const rest = remaining === 0 ? 'rest after this' : `${String(remaining)} more before rest`;
    return `fight ${String(position)}/${String(CHAIN_SIZE)} on this health · ${rest}`;
  }

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
      this.carryLine(),
    ].join('\n');
  }

  /**
   * GDD §13, reduced to what M0 holds. Every line is read off the session log
   * or the encounter data — the screen formats, it does not count.
   */
  private deathReport(): DeathReport {
    const totals = this.session.totals(Object.keys(this.state.catalogue).map(cardId));
    const encounter = encounterAt(this.encounterIndex);
    const position = this.encounterIndex + 1;

    return {
      cause: this.causeOfDeath(),
      reached: `fell on fight ${String(position)} of ${String(ENCOUNTERS.length)} — ${encounter.name}`,
      played:
        `${String(totals.cardsPlayed)} cards · ${String(totals.waits)} waits · ` +
        `${String(totals.staggers)} staggers · ${String(totals.damageTaken)} damage taken`,
      unplayed:
        totals.neverPlayed.length === 0
          ? 'you played every card in the deck'
          : `never played: ${totals.neverPlayed.join(', ')}`,
      seed: `seed ${String(SESSION_SEED)}`,
    };
  }

  /** Names the blow or the status that finished the run (GDD §13). */
  private causeOfDeath(): string {
    const harm = this.session.lastHarm();
    if (harm === null) return 'killed by something the log did not see';
    if (harm.kind === 'status') {
      return `${harm.status} finished you for ${String(harm.amount)}`;
    }
    const name = findActor(this.state, harm.source)?.name ?? 'something';
    return `${name} finished you for ${String(harm.amount)}`;
  }

  /** What you take into the next fight — the whole point of §4.10. */
  private carryLine(): string {
    if (this.state.outcome === 'lost') return 'the set restarts from the first fight';

    const hp = findActor(this.state, PLAYER)?.hp ?? 0;
    const next = (this.encounterIndex + 1) % ENCOUNTERS.length;
    return startsChain(next)
      ? `you rest — the next fight starts at ${String(PLAYER_MAX_HP)} HP`
      : `you carry ${String(hp)} HP into the next fight`;
  }

  private teardown(): void {
    const views = this.views;
    if (views === null) return;

    views.fx.destroy();
    views.death.destroy();
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
    this.sfx.destroy();
    this.views = null;
  }
}

/** One blow that has already landed, ready to be drawn. */
interface LandedBlow {
  readonly target: ActorId;
  readonly amount: number;
  readonly lethal: boolean;
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

interface OpeningSpec {
  readonly index: number;
  readonly rules: CombatRules;
  /** Health carried in from the previous encounter (GDD §4.10). */
  readonly hp: number;
}

function openingState({ index, rules, hp }: OpeningSpec): CombatState {
  const catalogue = m0Catalogue();
  const started = startCombat({
    actors: encounterAt(index).actors.map((actor) =>
      actor.side === 'player' ? { ...actor, hp } : actor,
    ),
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
