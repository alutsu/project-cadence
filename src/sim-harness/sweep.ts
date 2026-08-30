import { m0Catalogue } from '../data/cards.ts';
import {
  CHAIN_SIZE,
  ENCOUNTERS,
  PLAYER_MAX_HP,
  startsChain,
  type Encounter,
} from '../data/encounters.ts';
import type { ActorSeed } from '../sim/combat.ts';
import { advanceToDecision, reduce, startCombat } from '../sim/combat.ts';
import { cardId } from '../sim/ids.ts';
import { createRng } from '../sim/rng.ts';
import type { Policy } from './policy.ts';
import { POLICIES } from './policy.ts';
import { playerActor } from '../sim/state.ts';

/** A runaway policy would otherwise hang the sweep; no M0 fight is this long. */
const DECISION_LIMIT = 400;

export interface EncounterOutcome {
  readonly won: boolean;
  readonly hp: number;
  readonly decisions: number;
}

export interface PlaySpec {
  readonly actors: readonly ActorSeed[];
  readonly policy: Policy;
  readonly seed: number;
}

/** Plays one encounter to its end and reports what the player had left. */
export function playEncounter(spec: PlaySpec): EncounterOutcome {
  const catalogue = m0Catalogue();
  const started = startCombat({
    actors: spec.actors,
    catalogue,
    deck: Object.keys(catalogue).map(cardId),
    rng: createRng(spec.seed, 'combat'),
  });

  let state = advanceToDecision(started.state).state;
  let decisions = 0;
  while (state.outcome === 'ongoing' && state.activeActorId !== null) {
    if (decisions >= DECISION_LIMIT) break;
    const result = reduce(state, spec.policy(state));
    if (!result.ok) break;
    state = advanceToDecision(result.step.state).state;
    decisions += 1;
  }

  return {
    won: state.outcome === 'won',
    hp: playerActor(state)?.hp ?? 0,
    decisions,
  };
}

function enteringAt(encounter: Encounter, hp: number): readonly ActorSeed[] {
  return encounter.actors.map((actor) => (actor.side === 'player' ? { ...actor, hp } : actor));
}

interface Summary {
  readonly losses: number;
  readonly hp: number;
  readonly decisions: number;
}

function summarise(encounter: Encounter, policy: Policy, seeds: number): Summary {
  let losses = 0;
  let hp = 0;
  let decisions = 0;
  for (let seed = 1; seed <= seeds; seed += 1) {
    const outcome = playEncounter({ actors: encounter.actors, policy, seed });
    if (!outcome.won) losses += 1;
    hp += outcome.hp;
    decisions += outcome.decisions;
  }
  return { losses: (losses / seeds) * 100, hp: hp / seeds, decisions: decisions / seeds };
}

/** Each encounter fought fresh at full HP: how long it runs and what it costs. */
export function sweep(seeds: number): string {
  const lines = [`per-encounter, ${String(seeds)} seeds, entering at full HP`, ''];
  for (const encounter of ENCOUNTERS) {
    lines.push(encounter.name);
    for (const { name, play } of POLICIES) {
      const { losses, hp, decisions } = summarise(encounter, play, seeds);
      lines.push(
        `  ${name.padEnd(9)} ${losses.toFixed(0).padStart(3)}% lost   ` +
          `${hp.toFixed(0).padStart(2)}/${String(PLAYER_MAX_HP)} HP left   ` +
          `${decisions.toFixed(1).padStart(4)} decisions`,
      );
    }
  }
  return lines.join('\n');
}

interface RunResult {
  /** How many encounters were cleared before dying, in set order. */
  readonly cleared: number;
}

/** One attempt at the whole set, stopping at the first defeat. */
function runSet(policy: Policy, seed: number): RunResult {
  let hp = PLAYER_MAX_HP;
  let cleared = 0;
  for (const [index, encounter] of ENCOUNTERS.entries()) {
    const entering = startsChain(index) ? PLAYER_MAX_HP : hp;
    const outcome = playEncounter({
      actors: enteringAt(encounter, entering),
      policy,
      seed: seed * 100 + index,
    });
    hp = outcome.hp;
    if (!outcome.won) break;
    cleared += 1;
  }
  return { cleared };
}

/**
 * The set played as one gauntlet, HP carrying between fights (GDD §4.10). This
 * is the number that matters: per-encounter difficulty means little when every
 * fight starts full.
 */
export function gauntlet(seeds: number): string {
  const lines = [
    '',
    `gauntlet, ${String(seeds)} seeds, HP carries within chains of ${String(CHAIN_SIZE)} (GDD §4.10)`,
    '',
  ];
  for (const { name, play } of POLICIES) {
    const depths: number[] = [];
    for (let seed = 1; seed <= seeds; seed += 1) depths.push(runSet(play, seed).cleared);
    const reached = ENCOUNTERS.map((_, index) => depths.filter((depth) => depth > index).length);
    const finished = depths.filter((depth) => depth === ENCOUNTERS.length).length;
    const cleared = reached
      .map((count) => ((count / seeds) * 100).toFixed(0).padStart(3))
      .join('%  ');
    const rate = ((finished / seeds) * 100).toFixed(0);
    lines.push(`  ${name.padEnd(9)} cleared ${cleared}%   finished the set ${rate}%`);
  }
  return lines.join('\n');
}
