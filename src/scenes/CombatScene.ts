import Phaser from 'phaser';
import { CHAIN_SIZE, ENCOUNTERS, PLAYER, startsChain } from '../data/encounters.ts';
import type { Action } from '../sim/actions.ts';
import {
  absorbEncounter,
  encounterSetup,
  restartRun,
  startRun,
  type RunState,
} from '../run/RunState.ts';
import { isAlive } from '../sim/actor.ts';
import type { CardDefinition } from '../sim/card.ts';
import { advanceToDecision, reduce, startCombat } from '../sim/combat.ts';
import { previewAction } from '../sim/forecast.ts';
import { cardId, type ActorId, type CardId } from '../sim/ids.ts';
import { ULTIMATE_RULES, type CombatRules } from '../sim/rules.ts';
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
import { openingReport } from '../ui/openingReport.ts';
import { SessionLog } from '../ui/SessionLog.ts';
import { Sfx } from '../ui/Sfx.ts';
import { TuningPanel } from '../ui/TuningPanel.ts';
import { QueueStrip } from '../ui/QueueStrip.ts';
import { TurnPlayback, type BeatPace } from '../ui/TurnPlayback.ts';
import { beatsOf, type Beat } from '../ui/turnBeats.ts';
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
  /**
   * Everything that outlives this fight (GDD §5, §7). The scene holds a
   * reference and never a copy — it reads the run and hands it back, so no game
   * number lives on a Phaser object (CLAUDE.md §4.1).
   */
  private run: RunState = startRun(SESSION_SEED);
  private animations = true;
  private readonly session = new SessionLog();
  /**
   * This encounter's log, kept because Saturation is folded from it at the end
   * (GDD §7.3) rather than tracked alongside the fight (CLAUDE.md §2.2).
   */
  private encounterEvents: CombatEvent[] = [];
  private readonly sfx = new Sfx();
  private opening: Opening = openingState(this.run);
  private state: CombatState = this.opening.state;
  private target: ActorId | null = null;
  private views: CombatViews | null = null;
  private autoWait: Phaser.Time.TimerEvent | null = null;
  /**
   * The turns between one decision and the next, played one at a time. Every
   * beat it holds has already been resolved by the reducer — it decides how
   * fast the queue drains, never what drains out of it (GDD §15).
   */
  private readonly playback = new TurnPlayback({
    scene: this,
    onBeat: (beat, pace) => {
      this.showBeat(beat, pace);
    },
    onDone: () => {
      this.settle();
    },
  });
  /**
   * Whether a click may dismiss a finished encounter. The click that lands the
   * killing blow must not also clear the screen reporting it — pointer-down
   * plays the card, the outcome changes inside that same event, and the global
   * handler would then advance on the very press that caused the death. Armed
   * on release, so dismissing always takes a second, deliberate click.
   */
  private dismissArmed = false;
  /**
   * The same hazard, one beat earlier: Phaser delivers a card's own
   * `pointerdown` before the scene-level one, so the press that plays a card
   * arrives at the global handler too — and would skip the playback it just
   * started, resolving every action instantly (GDD §15).
   *
   * Set by the press that acts and consumed by that same press's scene handler,
   * which always follows it. Release is no help here: a press and release
   * inside one frame reach Phaser as a single pointer update.
   */
  private actedOnThisPress = false;

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
          this.commitFromPress({ kind: 'wait' });
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

    this.views.readout.setIdleNote(openingReport(this.state, this.opening.events));
    this.installTuningKeys();

    // Once an encounter is over the cards are inert, so a click anywhere is
    // unambiguous: it means "next".
    this.input.on(Phaser.Input.Events.POINTER_DOWN, () => {
      // Browsers only hand over an audio context inside a real gesture.
      this.sfx.unlock();
      const ownPress = this.actedOnThisPress;
      this.actedOnThisPress = false;

      // GDD §15: a *later* click while the queue is draining skips to the end
      // of it. Nothing is lost — the board it lands on is the one already
      // waiting.
      if (this.playback.isPlaying) {
        if (!ownPress) this.playback.skip();
        return;
      }
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
   * The ghost preview (GDD §4.2). The strip, the enemies and the readout
   * change; the hand must not be rebuilt under the pointer hovering it.
   */
  private previewCard(card: CardDefinition | null): void {
    if (this.playback.isPlaying) return;
    const target = this.currentTarget();
    if (card === null || target === null) {
      this.clearPreview();
      return;
    }
    this.showPreview({ kind: 'play', card: card.id, target }, card.name.toUpperCase());
  }

  private previewWait(hovering: boolean): void {
    if (this.playback.isPlaying) return;
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
    views.queue.render({ state: this.state, preview, motion: 'snap' });
    views.enemies.render(this.state, this.target, preview);
    views.readout.render(label, preview);
  }

  private clearPreview(): void {
    const views = this.views;
    if (views === null) return;

    views.queue.render({ state: this.state, preview: null, motion: 'snap' });
    views.enemies.render(this.state, this.target, null);
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
      // Nothing carries between runs (GDD §9) — including the Attunement, so
      // the next attempt is a different world as well as a fresh one.
      this.run = restartRun(this.run);
      // The death screen has been read by now; the next attempt counts fresh.
      this.session.reset();
      this.restart();
      return;
    }

    this.run = absorbEncounter(this.run, {
      outcome: this.state.outcome,
      hp: findActor(this.state, PLAYER)?.hp ?? this.run.hp,
      events: this.encounterEvents,
    });
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
      this.retune({ guardCap: Math.max(5, this.run.rules.guardCap - 5) });
    });
    keys.on('keydown-H', () => {
      this.retune({ guardCap: this.run.rules.guardCap + 5 });
    });
    keys.on('keydown-J', () => {
      this.retune({ guardDecayPerTick: Math.max(0, this.run.rules.guardDecayPerTick - 1) });
    });
    keys.on('keydown-K', () => {
      this.retune({ guardDecayPerTick: this.run.rules.guardDecayPerTick + 1 });
    });
    keys.on('keydown-W', () => {
      this.retune({
        waitWeight: tick(this.run.rules.waitWeight >= 6 ? 2 : this.run.rules.waitWeight + 1),
      });
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
      this.run = {
        ...this.run,
        encounterIndex: (this.run.encounterIndex + 1) % ENCOUNTERS.length,
        hp: this.run.maxHp,
      };
      this.restart();
    });
  }

  private cycleUltimateRule(): void {
    const at = ULTIMATE_RULES.indexOf(this.run.rules.ultimate);
    this.retune({ ultimate: ULTIMATE_RULES[(at + 1) % ULTIMATE_RULES.length] ?? 'immediate' });
  }

  private retune(change: Partial<CombatRules>): void {
    this.run = { ...this.run, rules: { ...this.run.rules, ...change } };
    this.restart();
  }

  private restart(): void {
    this.playback.cancel();
    this.actedOnThisPress = false;
    this.dismissArmed = false;
    this.opening = openingState(this.run);
    this.encounterEvents = [...this.opening.events];
    this.state = this.opening.state;
    this.target = firstLivingEnemy(this.state);
    // GDD §4.1 lets a faster enemy act before the player ever sees the board.
    // Say so, or the missing HP reads as a bug from the last fight.
    this.views?.readout.setIdleNote(openingReport(this.state, this.opening.events));
    this.renderAll();
  }

  private selectTarget(actor: ActorId): void {
    if (this.playback.isPlaying) return;
    this.target = actor;
    this.renderAll();
  }

  private playCard(card: CardDefinition): void {
    const target = this.currentTarget();
    if (target === null) return;
    this.commitFromPress({ kind: 'play', card: card.id, target });
  }

  /**
   * An action taken by a press — a card, or the Wait button. Marks the press so
   * the scene handler that follows it knows the playback is its own doing.
   */
  private commitFromPress(action: Action): void {
    this.actedOnThisPress = true;
    this.commit(action);
  }

  /**
   * Illegal actions are refused by the reducer, not by the view — the UI simply
   * declines to re-render when its request is rejected (CLAUDE.md §5.4).
   */
  private commit(action: Action): void {
    // The board on screen is behind the sim until the queue has finished
    // draining, so there is no honest state to act from yet.
    if (this.playback.isPlaying) return;

    const result = reduce(this.state, action);
    if (!result.ok) return;

    this.views?.readout.setIdleNote(null);
    const played = beatsOf(this.state, result.step);
    const wasOngoing = this.state.outcome === 'ongoing';

    // The whole outcome is committed here, before a single frame of it is
    // drawn. Playback is a reading of state that is already true (GDD §15).
    this.state = played.settled;
    this.session.record(played.events, PLAYER);
    this.encounterEvents.push(...played.events);
    if (wasOngoing && this.state.outcome !== 'ongoing') {
      this.session.encounterFinished();
      this.dismissArmed = false;
    }

    // The animation toggle does not cancel the beats, it stops waiting on them
    // — the same board, read all at once instead of one turn at a time.
    if (this.animations) this.playback.play(played.beats);
    else this.playback.flush(played.beats);
  }

  /**
   * One turn of the drain, drawn. Every view reads the state as it stood at the
   * end of *this* beat, so the strip, the line and the clock agree on which
   * turn the player is watching.
   */
  private showBeat(beat: Beat, pace: BeatPace): void {
    const views = this.views;
    if (views === null) return;

    const over = beat.after.outcome !== 'ongoing';
    views.queue.render({
      state: beat.after,
      preview: null,
      motion: pace === 'paced' ? 'march' : 'snap',
    });
    views.enemies.render(beat.after, this.targetIn(beat.after), null);
    views.bar.render(beat.after);
    views.piles.render(beat.after);
    if (over) views.hand.hide();
    else views.hand.render(beat.after, this.targetIn(beat.after));

    this.soundOf(beat);
    if (pace === 'paced') this.sightOf(beat);
  }

  /** The queue has drained; the board catches up with the sim and goes live. */
  private settle(): void {
    this.target = this.currentTarget();
    this.renderAll();
  }

  /**
   * What a beat sounds like. Sound is never skipped: a skip is a request for
   * less waiting, not for silence, and the report of a blow is how a flushed
   * beat is noticed at all.
   */
  private soundOf(beat: Beat): void {
    for (const event of beat.events) {
      if (event.kind === 'card_played' && event.actor === PLAYER) {
        this.playedCardSound(beat.before, event.card);
      }
      if (event.kind === 'waited') this.sfx.guard();
      if (event.kind === 'damage_dealt') this.sfx.impact(event.amount);
      if (event.kind === 'staggered') this.sfx.stagger();
      if (event.kind === 'actor_died') this.sfx.death();
    }
  }

  /** A card's report is its Weight class — the heavier it is, the deeper. */
  private playedCardSound(before: CombatState, card: CardId): void {
    const played = findCard(before.catalogue, card);
    if (played === undefined) return;
    this.sfx.strike(played.weightClass);
  }

  /**
   * What a beat looks like. Every value here is read out of the event log after
   * the reducer ran, so nothing this method does can change an outcome — which
   * is what makes dropping it on a skip safe (GDD §15).
   *
   * Seats come from the state the beat started in: an enemy killed by this beat
   * has already left the line, and its blow should still land where it stood.
   */
  private sightOf(beat: Beat): void {
    const died = new Set(
      beat.events.filter((event) => event.kind === 'actor_died').map((event) => event.actor),
    );

    for (const event of beat.events) {
      if (event.kind === 'card_played' && event.actor === PLAYER) {
        this.playedCardFx(beat.before, event.card);
        continue;
      }
      if (event.kind === 'damage_dealt') {
        this.landedBlowFx(beat.before, {
          target: event.target,
          amount: event.amount,
          lethal: died.has(event.target),
        });
        continue;
      }
      if (event.kind === 'staggered') this.views?.queue.flashStagger(event.actor, event.delay);
    }
  }

  private playedCardFx(before: CombatState, card: CardId): void {
    const definition = findCard(before.catalogue, card);
    if (definition === undefined) return;

    const index = before.hand.indexOf(card);
    const target = this.targetIn(before);
    if (index === -1 || target === null) return;

    const to = enemySeat(before, target);
    if (to === null) return;
    this.views?.fx.strike({
      from: handSeat({ index, count: before.hand.length }),
      to,
      name: definition.name.toUpperCase(),
    });
  }

  private landedBlowFx(before: CombatState, blow: LandedBlow): void {
    const at = enemySeat(before, blow.target);
    // The player has no silhouette to hang a figure on (GDD §15.1), so an
    // incoming blow is heard rather than drawn.
    if (at === null) return;

    this.views?.fx.impact({ at, amount: blow.amount, lethal: blow.lethal });
    this.views?.enemies.flashHit(blow.target);
  }

  /** GDD §4.8: the target persists, and killing it advances to the next enemy. */
  private currentTarget(): ActorId | null {
    return this.targetIn(this.state);
  }

  /**
   * Who the player is aiming at in a given state. Asked per beat as well as per
   * decision, so the line highlights the enemy that was actually being struck
   * at that point in the drain rather than the one that inherited the target.
   */
  private targetIn(state: CombatState): ActorId | null {
    const held = this.target;
    if (held !== null) {
      const actor = findActor(state, held);
      if (actor !== undefined && isAlive(actor)) return held;
    }
    return firstLivingEnemy(state);
  }

  private renderAll(): void {
    const views = this.views;
    if (views === null) return;

    const over = this.state.outcome !== 'ongoing';
    views.queue.render({ state: this.state, preview: null, motion: 'snap' });
    views.enemies.render(this.state, this.target, null);
    // The cards are inert once the fight is over, and the summary needs the
    // room they occupy.
    if (over) views.hand.hide();
    else views.hand.render(this.state, this.currentTarget());
    views.bar.render(this.state);
    if (over) views.readout.hide();
    else views.readout.render('', null);
    views.piles.render(this.state);
    views.banner.render(
      encounterAt(this.run.encounterIndex).name,
      `${encounterAt(this.run.encounterIndex).teaches}   ·   ${this.chainLabel()}   ·   seed ${String(SESSION_SEED)}`,
      this.state.outcome === 'won' ? this.endOfEncounterSummary() : '',
    );
    views.tuning.render(this.run.rules, {
      animations: this.animations,
      sound: !this.sfx.isMuted(),
    });
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
      !this.playback.isPlaying &&
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
    const position = (this.run.encounterIndex % CHAIN_SIZE) + 1;
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
    const encounter = encounterAt(this.run.encounterIndex);
    const position = this.run.encounterIndex + 1;

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
    const next = (this.run.encounterIndex + 1) % ENCOUNTERS.length;
    return startsChain(next)
      ? // The run's Max HP, not the baseline: a socket lowers the ceiling you
        // are restored to (GDD §6.1), and a rest that promised 70 would be
        // lying about the one cost the build layer actually charges.
        `you rest — the next fight starts at ${String(this.run.maxHp)} HP`
      : `you carry ${String(hp)} HP into the next fight`;
  }

  private teardown(): void {
    const views = this.views;
    if (views === null) return;

    this.playback.destroy();
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

/** The state an encounter opens on, and everything that happened getting there. */
interface Opening {
  readonly state: CombatState;
  readonly events: readonly CombatEvent[];
}

/**
 * The scene asks the run for an encounter and does not assemble one itself.
 * Which cards, which Weave, which sockets, and what HP to enter on are all
 * facts about the run (CLAUDE.md §4.1: a Scene is wiring).
 */
function openingState(run: RunState): Opening {
  const started = startCombat(encounterSetup(run));
  const opened = advanceToDecision(started.state);
  return { state: opened.state, events: [...started.events, ...opened.events] };
}

function firstLivingEnemy(state: CombatState): ActorId | null {
  return state.actors.find((actor) => actor.side === 'enemy' && isAlive(actor))?.id ?? null;
}
