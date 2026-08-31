import {
  absorbEncounter,
  craft,
  encounterSetup,
  maxHpFloor,
  NORMAL_BASE_XP,
  openSocket,
  seat,
  startRun,
  type RunState,
} from '../run/RunState.ts';
import { socketPrice, socketsOf } from '../run/socket.ts';
import { advanceToDecision, reduce, startCombat } from '../sim/combat.ts';
import type { CombatEvent } from '../sim/events.ts';
import { FRAMES, type Frame } from '../sim/gem.ts';
import type { CardId } from '../sim/ids.ts';
import { createRng, type Rng } from '../sim/rng.ts';
import { ENCOUNTERS } from '../data/encounters.ts';
import { POLICIES, type Policy } from './policy.ts';

/**
 * Build-aware runs (GDD §19).
 *
 * §19 names one metric as the key one *for this design specifically*: **build
 * diversity among winning runs**. If the top three combinations account for
 * more than 35% of wins, the anti-meta thesis of §23 is failing and §7's
 * destabilisers need strengthening. That number cannot be computed until a
 * policy can socket, so this module teaches them to.
 *
 * These are deliberately poor builders — none of them reads the Weave before
 * choosing a frame. Read every figure as a *floor* a thinking player beats, and
 * read the **gaps** rather than the absolute numbers.
 */

/** How a policy decides what to build between fights. */
export type Builder = (run: RunState, rng: Rng) => RunState;

export interface NamedBuilder {
  readonly name: string;
  readonly build: Builder;
}

const DECISION_LIMIT = 400;

/** Every distinct card in the deck, which is what a socket can go on. */
function deckCards(run: RunState): readonly CardId[] {
  return [...new Set(run.deck)];
}

/** Whether a socket attempt is affordable and legal right now (GDD §6.1). */
function canAfford(run: RunState, card: CardId): boolean {
  const price = socketPrice({
    sockets: socketsOf(run.build.sockets, card),
    maxHp: run.maxHp,
    floor: maxHpFloor(run),
    insight: run.insight,
  });
  return (
    price !== null && run.maxHp - price.maxHp >= maxHpFloor(run) && run.insight >= price.insight
  );
}

/** Crafts what it can, then seats it wherever a socket is open. */
function craftAndSeat(run: RunState, frame: Frame): RunState {
  const made = craft(run, { frame, tier: 1 });
  if (!made.ok) return run;

  const target = deckCards(made.run).find((card) => {
    const sockets = socketsOf(made.run.build.sockets, card);
    return sockets.gems.length < sockets.opened;
  });
  if (target === undefined) return made.run;

  const seated = seat(made.run, target, made.value);
  return seated.ok ? seated.run : made.run;
}

/**
 * Opens what it can afford, cheapest card first. Deliberately reckless about
 * the floor's proximity — §22 Q5 asks whether the only-downward Max HP is a
 * death spiral, and a builder that stopped early would hide the answer.
 */
const greedySockets = (run: RunState): RunState => {
  const card = deckCards(run).find((candidate) => canAfford(run, candidate));
  if (card === undefined) return run;

  const opened = openSocket(run, card);
  return opened.ok ? opened.run : run;
};

/** One frame, forever. The mono-build, and the one Saturation should punish. */
function devotee(frame: Frame): Builder {
  return (run: RunState): RunState => craftAndSeat(greedySockets(run), frame);
}

/** A different frame every time, chosen off the run's own stream. */
const magpie: Builder = (run: RunState, rng: Rng): RunState => {
  const frame = FRAMES[rng.nextInt(FRAMES.length)] ?? 'REPEAT';
  return craftAndSeat(greedySockets(run), frame);
};

/** Sockets nothing at all — the control, and the M0 baseline. */
const ascetic: Builder = (run: RunState): RunState => run;

export const BUILDERS: readonly NamedBuilder[] = [
  { name: 'ascetic', build: ascetic },
  { name: 'magpie', build: magpie },
  { name: 'repeater', build: devotee('REPEAT') },
  { name: 'warden', build: devotee('WARD') },
  { name: 'breaker', build: devotee('BREAK') },
  { name: 'siphoner', build: devotee('SIPHON') },
];

export interface RunOutcome {
  readonly cleared: number;
  readonly won: boolean;
  /** Frames seated by the end, in socket order across the deck. */
  readonly frames: readonly Frame[];
  readonly maxHp: number;
  readonly hitFloor: boolean;
  readonly sockets: number;
  /** Where the §5.1 curve actually got to, and how big the deck grew. */
  readonly level: number;
  readonly deck: number;
}

interface FightResult {
  readonly outcome: 'won' | 'lost' | 'ongoing';
  readonly hp: number;
  readonly events: readonly CombatEvent[];
}

/** One encounter, played to its end by a policy. */
function fightOne(run: RunState, policy: Policy): FightResult {
  const started = startCombat(encounterSetup(run));
  const opening = advanceToDecision(started.state);
  const events: CombatEvent[] = [...started.events, ...opening.events];
  let state = opening.state;

  for (let taken = 0; taken < DECISION_LIMIT; taken += 1) {
    if (state.outcome !== 'ongoing' || state.activeActorId === null) break;
    const result = reduce(state, policy(state));
    if (!result.ok) break;
    const advanced = advanceToDecision(result.step.state);
    events.push(...result.step.events, ...advanced.events);
    state = advanced.state;
  }

  return {
    outcome: state.outcome,
    hp: state.actors.find((actor) => actor.side === 'player')?.hp ?? run.hp,
    events,
  };
}

/** One whole run: build between fights, play each one to its end. */
export function playRun(spec: {
  readonly policy: Policy;
  readonly builder: Builder;
  readonly seed: number;
}): RunOutcome {
  let run = startRun(spec.seed);
  const rng = createRng(spec.seed, 'gemRoll');
  let cleared = 0;

  for (const _ of ENCOUNTERS) {
    void _;
    run = spec.builder(run, rng);

    const fought = fightOne(run, spec.policy);
    if (fought.outcome !== 'won') break;

    cleared += 1;
    run = absorbEncounter(run, {
      outcome: 'won',
      hp: fought.hp,
      events: fought.events,
      baseXp: NORMAL_BASE_XP,
    });
  }

  const frames = Object.values(run.build.sockets)
    .flatMap((sockets) => sockets.gems)
    .map((id) => run.build.gems[id]?.frame)
    .filter((frame): frame is Frame => frame !== undefined);

  return {
    cleared,
    won: cleared === ENCOUNTERS.length,
    frames,
    maxHp: run.maxHp,
    hitFloor: run.maxHp <= maxHpFloor(run),
    sockets: Object.values(run.build.sockets).reduce((total, s) => total + s.opened, 0),
    level: run.level,
    deck: run.deck.length,
  };
}

/** The signature of a build: which frames, sorted, so order is not identity. */
export function buildSignature(outcome: RunOutcome): string {
  return outcome.frames.length === 0 ? '(none)' : [...outcome.frames].sort().join('+');
}

/** GDD §19's threshold: above this, the top three are the meta. */
export const DIVERSITY_LIMIT = 0.35;
/** GDD §19's other red flag: a frame in more than this share of winners. */
export const FRAME_LIMIT = 0.4;

export interface Diversity {
  readonly wins: number;
  /** How many runs the shares below are computed over. */
  readonly measured: number;
  /** False when nothing won and the fallback below was used instead. */
  readonly fromWins: boolean;
  /** The share of wins the three commonest builds account for (§19). */
  readonly topThreeShare: number;
  readonly commonest: readonly { readonly build: string; readonly share: number }[];
  readonly overusedFrames: readonly { readonly frame: Frame; readonly share: number }[];
}

/**
 * GDD §19's key metric, and the only one that measures the thesis rather than
 * the balance. A build layer can be perfectly tuned and still fail this.
 */
export function diversityOf(outcomes: readonly RunOutcome[]): Diversity {
  const won = outcomes.filter((outcome) => outcome.won);

  // §19 asks about *winning* runs. When nothing wins, the honest fallback is
  // the runs that got furthest — it answers a weaker question ("do different
  // builds die in different places?") but it is a real signal, and printing a
  // top-three share of 0% would look like a pass when it is a no-reading.
  const deepest = Math.max(0, ...outcomes.map((outcome) => outcome.cleared));
  const winners = won.length > 0 ? won : outcomes.filter((o) => o.cleared === deepest);

  if (winners.length === 0) {
    return {
      wins: 0,
      measured: 0,
      fromWins: false,
      topThreeShare: 0,
      commonest: [],
      overusedFrames: [],
    };
  }

  const builds = new Map<string, number>();
  for (const winner of winners) {
    const key = buildSignature(winner);
    builds.set(key, (builds.get(key) ?? 0) + 1);
  }

  const ranked = [...builds.entries()]
    .map(([build, count]) => ({ build, share: count / winners.length }))
    .sort((a, b) => b.share - a.share);

  const overusedFrames = FRAMES.map((frame) => ({
    frame,
    share: winners.filter((winner) => winner.frames.includes(frame)).length / winners.length,
  })).filter((entry) => entry.share > FRAME_LIMIT);

  return {
    wins: won.length,
    measured: winners.length,
    fromWins: won.length > 0,
    topThreeShare: ranked.slice(0, 3).reduce((total, entry) => total + entry.share, 0),
    commonest: ranked.slice(0, 5),
    overusedFrames,
  };
}

/** One line of the table: what this pairing did, averaged over its seeds. */
function rowFor(builder: string, policy: string, outcomes: readonly RunOutcome[]): string {
  const won = outcomes.filter((outcome) => outcome.won).length;
  const cleared = outcomes.reduce((total, o) => total + o.cleared, 0) / outcomes.length;
  const level = outcomes.reduce((total, o) => total + o.level, 0) / outcomes.length;
  const deck = outcomes.reduce((total, o) => total + o.deck, 0) / outcomes.length;
  const sockets = outcomes.reduce((total, o) => total + o.sockets, 0) / outcomes.length;
  const maxHp = outcomes.reduce((total, o) => total + o.maxHp, 0) / outcomes.length;
  const floored = outcomes.filter((outcome) => outcome.hitFloor).length;

  return (
    `  ${builder.padEnd(10)} ${policy.padEnd(10)} ` +
    `${percent(won / outcomes.length).padStart(4)}   ` +
    `${cleared.toFixed(1).padStart(5)}   ` +
    `${level.toFixed(1).padStart(5)}   ` +
    `${deck.toFixed(1).padStart(4)}   ` +
    `${sockets.toFixed(1).padStart(5)}   ` +
    `${maxHp.toFixed(0).padStart(6)}   ` +
    percent(floored / outcomes.length).padStart(6)
  );
}

function percent(share: number): string {
  return `${(share * 100).toFixed(0)}%`;
}

/** The build report (GDD §19). Read the gaps, not the absolute numbers. */
export function buildReport(seeds: number): string {
  const lines = [
    '',
    `build diversity, ${String(seeds)} seeds per pairing (GDD §19)`,
    '',
    '  builder    policy      won   fights   level   deck   sockets   Max HP   at floor',
  ];

  const pairings = BUILDERS.flatMap((builder) => POLICIES.map((policy) => ({ builder, policy })));

  const all: RunOutcome[] = [];
  for (const { builder, policy } of pairings) {
    const outcomes = Array.from({ length: seeds }, (_, index) =>
      playRun({ policy: policy.play, builder: builder.build, seed: index + 1 }),
    );
    all.push(...outcomes);
    lines.push(rowFor(builder.name, policy.name, outcomes));
  }

  const diversity = diversityOf(all);
  const over = diversity.fromWins ? 'wins' : 'deepest runs';
  lines.push('', `  winning runs: ${String(diversity.wins)} of ${String(all.length)}`);
  if (!diversity.fromWins) {
    lines.push(
      '  NOTHING WON — §19 asks about winning runs, so the share below is over',
      '  the runs that got furthest instead. It is a weaker reading and the',
      '  encounter set is the thing to fix before trusting it.',
    );
  }
  lines.push(
    `  top three builds account for ${percent(diversity.topThreeShare)} of ${over} ` +
      `(GDD §19 red flag above ${percent(DIVERSITY_LIMIT)})`,
  );
  for (const entry of diversity.commonest) {
    lines.push(`    ${percent(entry.share).padStart(4)}  ${entry.build}`);
  }
  if (diversity.overusedFrames.length > 0) {
    lines.push('', `  frames in over ${percent(FRAME_LIMIT)} of measured builds:`);
    for (const entry of diversity.overusedFrames) {
      lines.push(`    ${percent(entry.share).padStart(4)}  ${entry.frame}`);
    }
  }

  return lines.join('\n');
}
