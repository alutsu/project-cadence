import { parseArgs } from 'node:util';
import { advanceToDecision, reduce, startCombat } from '../sim/combat.ts';
import type { CombatEvent } from '../sim/events.ts';
import { formatEvent } from './format.ts';
import { greedyDamage } from './policy.ts';
import { scenario } from './scenario.ts';
import { gauntlet, sweep } from './sweep.ts';

/**
 * Headless driver (GDD §19, CLAUDE.md §7.3). S1 runs one scripted encounter and
 * prints the timeline as text, which is how the scheduler was developed before
 * any of it could be seen on screen.
 */
const DEFAULT_DECISIONS = 8;
const DEFAULT_SEEDS = 200;

function run(decisions: number): readonly CombatEvent[] {
  const started = startCombat(scenario());
  const opening = advanceToDecision(started.state);
  const events: CombatEvent[] = [...started.events, ...opening.events];
  let state = opening.state;

  for (let taken = 0; taken < decisions; taken += 1) {
    if (state.outcome !== 'ongoing' || state.activeActorId === null) break;

    const result = reduce(state, greedyDamage(state));
    if (!result.ok) throw new Error(`policy produced an illegal action: ${result.error.reason}`);

    const advanced = advanceToDecision(result.step.state);
    events.push(...result.step.events, ...advanced.events);
    state = advanced.state;
  }

  return events;
}

function main(): void {
  const { values } = parseArgs({
    options: {
      decisions: { type: 'string' },
      sweep: { type: 'boolean' },
      seeds: { type: 'string' },
    },
  });

  if (values.sweep === true) {
    const seeds = values.seeds === undefined ? DEFAULT_SEEDS : Number(values.seeds);
    if (!Number.isInteger(seeds) || seeds <= 0) {
      throw new RangeError(`--seeds must be a positive integer, received ${String(values.seeds)}`);
    }
    process.stdout.write(`${sweep(seeds)}\n${gauntlet(seeds)}\n`);
    return;
  }

  const requested = values.decisions === undefined ? DEFAULT_DECISIONS : Number(values.decisions);
  if (!Number.isInteger(requested) || requested <= 0) {
    throw new RangeError(
      `--decisions must be a positive integer, received ${String(values.decisions)}`,
    );
  }

  for (const event of run(requested)) process.stdout.write(`${formatEvent(event)}\n`);
}

main();
