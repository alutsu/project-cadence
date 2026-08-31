import type { WeightClass } from '../sim/weightClass.ts';

/**
 * Sound, synthesised rather than loaded. GDD §15.1 spends the whole budget on
 * flat colour and one typeface, and an audio file would be the first asset in
 * the project — so these are oscillators, and the repo stays text.
 *
 * The pitch of a strike falls with its Weight class. That is the point rather
 * than decoration: pillar P1 says time is the only cost, so the heaviest thing
 * you can do should be the lowest, slowest sound you can hear (GDD §4.1).
 */
const STRIKE_HZ: Readonly<Record<WeightClass, number>> = {
  light: 520,
  standard: 390,
  heavy: 260,
  ultimate: 150,
};

const STRIKE_MS: Readonly<Record<WeightClass, number>> = {
  light: 90,
  standard: 130,
  heavy: 200,
  ultimate: 340,
};

/** Loud enough to read, quiet enough to leave on for an hour (GDD §18). */
const VOLUME = 0.16;
const IMPACT_MS = 120;
/** The damage that counts as a full-volume hit; more than this does not shout. */
const LOUD_DAMAGE = 30;
const STAGGER_HZ = [660, 990] as const;
const STAGGER_MS = 70;
const GUARD_HZ = 300;
const GUARD_MS = 180;
const DEATH_FROM_HZ = 220;
const DEATH_TO_HZ = 70;
const DEATH_MS = 520;

/**
 * A voice for the combat screen.
 *
 * The context is built at the first sound rather than from a separate unlock on
 * the scene's pointer handler. Every sound here is raised synchronously inside
 * a user gesture — a card click, the Wait button, a tuning key — which is the
 * browser's whole condition for starting audio, so building it on demand meets
 * the policy without a second mechanism to keep in step. Doing it from the
 * scene's own `POINTER_DOWN` did not: Phaser dispatches a game object's
 * `pointerdown` before the scene-level one, so the card's strike, its impact
 * and every enemy turn that followed were all raised against a context that did
 * not exist yet, and the first action of every encounter was silent.
 */
export class Sfx {
  private context: AudioContext | null = null;
  private muted = false;

  /**
   * Pumps a context the *browser* suspended — backgrounding the tab does that,
   * and an hour of playtesting (GDD §18) will hit it. Never builds one: outside
   * a gesture that would only produce a context stuck suspended.
   */
  unlock(): void {
    if (this.context !== null && this.context.state === 'suspended') void this.context.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  /** A card leaving the hand, pitched by what it costs in ticks. */
  strike(weightClass: WeightClass): void {
    this.tone({
      from: STRIKE_HZ[weightClass],
      to: STRIKE_HZ[weightClass] / 2,
      ms: STRIKE_MS[weightClass],
      type: 'triangle',
      gain: VOLUME,
    });
  }

  /** The blow landing. Louder for more damage, but capped. */
  impact(amount: number): void {
    const share = Math.min(1, Math.max(0, amount) / LOUD_DAMAGE);
    this.noise(IMPACT_MS, VOLUME * (0.4 + 0.6 * share));
  }

  /** The payoff moment, and the only rising figure in the set (GDD §4.6). */
  stagger(): void {
    STAGGER_HZ.forEach((hz, step) => {
      this.tone({
        from: hz,
        to: hz,
        ms: STAGGER_MS,
        type: 'square',
        gain: VOLUME * 0.5,
        delayMs: step * STAGGER_MS,
      });
    });
  }

  /** Wait: the sound of buying time rather than spending it (GDD §4.3). */
  guard(): void {
    this.tone({
      from: GUARD_HZ,
      to: GUARD_HZ * 1.5,
      ms: GUARD_MS,
      type: 'sine',
      gain: VOLUME * 0.6,
    });
  }

  death(): void {
    this.tone({
      from: DEATH_FROM_HZ,
      to: DEATH_TO_HZ,
      ms: DEATH_MS,
      type: 'sawtooth',
      gain: VOLUME * 0.7,
    });
  }

  /** Frees the context; the scene owns this voice and must close it (§6). */
  destroy(): void {
    void this.context?.close();
    this.context = null;
  }

  private ready(): AudioContext | null {
    if (this.muted) return null;

    const context = (this.context ??= new AudioContext());
    // A context built inside a gesture comes up running. One the browser
    // suspended does not, and resuming is asynchronous — so this sound is lost
    // and the next one is heard, which is the right trade against holding a
    // queue of stale sounds for a fight that has already moved on.
    if (context.state !== 'running') {
      void context.resume();
      return null;
    }
    return context;
  }

  private tone(spec: ToneSpec): void {
    const context = this.ready();
    if (context === null) return;

    const start = context.currentTime + (spec.delayMs ?? 0) / 1000;
    const end = start + spec.ms / 1000;

    const oscillator = context.createOscillator();
    oscillator.type = spec.type;
    oscillator.frequency.setValueAtTime(spec.from, start);
    oscillator.frequency.exponentialRampToValueAtTime(spec.to, end);

    const envelope = context.createGain();
    envelope.gain.setValueAtTime(spec.gain, start);
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);

    oscillator.connect(envelope).connect(context.destination);
    oscillator.onended = () => {
      envelope.disconnect();
    };
    oscillator.start(start);
    oscillator.stop(end);
  }

  private noise(ms: number, gain: number): void {
    const context = this.ready();
    if (context === null) return;

    const frames = Math.floor((context.sampleRate * ms) / 1000);
    const buffer = context.createBuffer(1, frames, context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let frame = 0; frame < frames; frame += 1) {
      // Decaying white noise: a thud rather than a hiss.
      samples[frame] = (Math.random() * 2 - 1) * (1 - frame / frames);
    }

    const source = context.createBufferSource();
    source.buffer = buffer;

    const envelope = context.createGain();
    envelope.gain.setValueAtTime(gain, context.currentTime);

    source.connect(envelope).connect(context.destination);
    source.onended = () => {
      envelope.disconnect();
    };
    source.start();
  }
}

interface ToneSpec {
  readonly from: number;
  readonly to: number;
  readonly ms: number;
  readonly type: OscillatorType;
  readonly gain: number;
  readonly delayMs?: number;
}
