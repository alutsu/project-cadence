import Phaser from 'phaser';
import type { Beat } from './turnBeats.ts';
import { FX } from './theme.ts';

/**
 * How a beat reaches the screen. `paced` means it has the interval to itself
 * and can be animated; `flushed` means a skip is landing it now, along with
 * every other beat left, so it should only leave its result behind.
 */
export type BeatPace = 'paced' | 'flushed';

export interface TurnPlaybackOptions {
  readonly scene: Phaser.Scene;
  /** Draw one beat. Called once per beat, in order. */
  readonly onBeat: (beat: Beat, pace: BeatPace) => void;
  /** The last beat has been drawn; the board is live again. */
  readonly onDone: () => void;
}

/**
 * Paces the beats of one committed action (GDD §15).
 *
 * It owns nothing but a cursor and a timer: the sim resolved every beat before
 * playback started, so this class cannot change an outcome — it only decides
 * how fast the result is read. Skipping flushes the remainder in place, landing
 * on the same board the player would have reached by waiting.
 */
export class TurnPlayback {
  private readonly options: TurnPlaybackOptions;
  private pending: readonly Beat[] = [];
  private timer: Phaser.Time.TimerEvent | null = null;
  private playing = false;

  constructor(options: TurnPlaybackOptions) {
    this.options = options;
  }

  /**
   * True from the first beat until `onDone`. The board takes no input while it
   * holds — the state on screen is behind the state the reducer settled on.
   */
  get isPlaying(): boolean {
    return this.playing;
  }

  /** Draws the first beat now and schedules the rest one interval apart. */
  play(beats: readonly Beat[]): void {
    this.stopTimer();
    this.pending = beats;
    this.playing = true;
    this.step();
  }

  /**
   * Every beat at once, animating none of them — what the animation toggle
   * asks for. Not `play` followed by `skip`: that would still pace the first
   * beat, which is the one the toggle is most visibly about (GDD §15).
   */
  flush(beats: readonly Beat[]): void {
    this.stopTimer();
    this.pending = beats;
    this.playing = true;
    this.drain();
  }

  /** Every *remaining* beat at once, ending on the same board (GDD §15). */
  skip(): void {
    if (!this.playing) return;
    this.stopTimer();
    this.drain();
  }

  /** Abandons playback without drawing what is left — the board is changing. */
  cancel(): void {
    this.stopTimer();
    this.pending = [];
    this.playing = false;
  }

  destroy(): void {
    this.cancel();
  }

  private step(): void {
    const [beat, ...rest] = this.pending;
    if (beat === undefined) {
      this.finish();
      return;
    }

    this.pending = rest;
    this.options.onBeat(beat, 'paced');

    // The last beat still gets its interval before the board goes live, so the
    // blow that ends a turn is read rather than glimpsed under the next hand.
    this.timer = this.options.scene.time.delayedCall(FX.beatMs, () => {
      this.timer = null;
      this.step();
    });
  }

  private drain(): void {
    const remaining = this.pending;
    this.pending = [];
    for (const beat of remaining) this.options.onBeat(beat, 'flushed');
    this.finish();
  }

  private finish(): void {
    this.playing = false;
    this.options.onDone();
  }

  private stopTimer(): void {
    this.timer?.remove();
    this.timer = null;
  }
}
