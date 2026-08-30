import { describe, expect, it } from 'vitest';
import { m0Catalogue } from '../../src/data/cards.ts';
import { ENCOUNTERS, PLAYER } from '../../src/data/encounters.ts';
import { advanceToDecision, startCombat } from '../../src/sim/combat.ts';
import { cardId } from '../../src/sim/ids.ts';
import { createRng } from '../../src/sim/rng.ts';
import { openingReport } from '../../src/ui/openingReport.ts';

function opening(index: number) {
  const encounter = ENCOUNTERS[index];
  if (encounter === undefined) throw new Error(`no encounter at ${String(index)}`);
  const catalogue = m0Catalogue();
  const started = startCombat({
    actors: encounter.actors,
    catalogue,
    deck: Object.keys(catalogue).map(cardId),
    rng: createRng(7, 'combat'),
  });
  const opened = advanceToDecision(started.state);
  return { state: opened.state, events: [...started.events, ...opened.events] };
}

/**
 * GDD §4.1 seeds actors at ceil(600 / speed), so a fast enemy acts before the
 * player is ever shown the board. The report is the only place that says so.
 */
describe('what happened before your first turn', () => {
  it('says nothing when nothing reached the player', () => {
    // The Warden is Speed 70 and seeds at t9, well after the player's t6.
    const quiet = opening(1);

    expect(openingReport(quiet.state, quiet.events)).toBeNull();
  });

  it('names each attacker and totals what it did', () => {
    // Two rats at Speed 130 both seed at t5 and both bite first.
    const scurry = opening(0);
    const line = openingReport(scurry.state, scurry.events);

    expect(line).toContain('before your first turn');
    expect(line).toContain('Poison Rat 2');
  });

  it('reports a status the player is already carrying into their first turn', () => {
    // The Chime Adept ties the player at t6 and wins on Speed (GDD §4.1), so
    // the first card is chosen while already Slowed.
    const discord = opening(2);
    const line = openingReport(discord.state, discord.events);

    expect(line).toContain('Chime Adept');
    expect(line).toContain('you are slow');
  });

  it('ignores damage the player deals and statuses the enemy carries', () => {
    const scurry = opening(0);
    const enemyEvents = scurry.events.filter(
      (event) => event.kind !== 'damage_dealt' || event.target !== PLAYER,
    );

    expect(openingReport(scurry.state, enemyEvents)).toBeNull();
  });
});
