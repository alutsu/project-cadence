import { describe, expect, it } from 'vitest';
import { m0Catalogue } from '../../src/data/cards.ts';
import { ENCOUNTERS } from '../../src/data/encounters.ts';
import { dominatedCards, gather } from '../../src/sim-harness/balance.ts';
import { POLICIES } from '../../src/sim-harness/policy.ts';

const SEEDS = 2;

/** How many enemy *seats* the whole set fields, counting actors not archetypes. */
function seatsOf(archetype: string): number {
  return ENCOUNTERS.reduce(
    (count, encounter) =>
      count + encounter.actors.filter((actor) => actor.name.startsWith(archetype)).length,
    0,
  );
}

/**
 * The report is the only thing that will say whether this game is balanced, so
 * it has to be right about the game (GDD §19). These pin what was wrong the
 * first time it ran.
 */
describe('the balance ledger (GDD §19, CLAUDE.md §7.3)', () => {
  const ledger = gather(SEEDS);
  const runsPerEncounter = POLICIES.length * SEEDS;

  it('counts an appearance per seat, not per archetype', () => {
    // Scurry fields two Poison Rats. Counting that as one appearance divided
    // two rats' damage and two deaths by one, and printed a 113% death rate.
    for (const [archetype, tallied] of ledger.enemies) {
      expect(tallied.appearances).toBe(seatsOf(archetype) * runsPerEncounter);
    }
  });

  it('never reports an enemy dying more often than it appeared', () => {
    for (const tallied of ledger.enemies.values()) {
      expect(tallied.deaths).toBeLessThanOrEqual(tallied.appearances);
    }
  });

  it('credits every card in the deck with the hands that held it', () => {
    for (const card of Object.values(m0Catalogue())) {
      const tallied = ledger.card(card.id);
      expect(tallied.held).toBeGreaterThan(0);
      expect(tallied.played).toBeLessThanOrEqual(tallied.held);
    }
  });

  it('credits damage only to a card that was actually played', () => {
    for (const card of Object.values(m0Catalogue())) {
      const tallied = ledger.card(card.id);
      if (tallied.played === 0) expect(tallied.damage).toBe(0);
      if (tallied.damage > 0) expect(tallied.ticksSpent).toBeGreaterThan(0);
    }
  });

  it('files every player death under a cause, never dropping one', () => {
    const causes = [...ledger.deathsBy.values()].reduce((sum, count) => sum + count, 0);
    const blows = [...ledger.enemies.values()].reduce(
      (sum, tallied) => sum + tallied.killingBlows,
      0,
    );

    expect(causes).toBeGreaterThan(0);
    // A death to Poison is filed as a status rather than under whoever last bit.
    expect(causes).toBeGreaterThanOrEqual(blows);
  });

  it('names the cards a sibling strictly beats', () => {
    const beaten = dominatedCards();

    // Every Light card but Lunge: they share Weight 4 and Recovery 8 from the
    // class table, and their tags are inert in M0, so only damage differs.
    expect(beaten.find((entry) => entry.card === 'Feint')?.beatenBy).toContain('Lunge');
    expect(beaten.map((entry) => entry.card)).not.toContain('Lunge');
    // An AoE is compared to the other AoE of its class, never to a
    // single-target card it does not trade against (GDD §4.8).
    expect(beaten.find((entry) => entry.card === 'Sweep')?.beatenBy).toEqual(['Cleave']);
  });
});
