import { describe, expect, it } from 'vitest';
import { m0Catalogue } from '../../src/data/cards.ts';
import { PLAYER, RAT, WARDEN, ratAndWarden } from '../../src/data/encounters.ts';
import type { Actor } from '../../src/sim/actor.ts';
import { advanceToDecision, startCombat } from '../../src/sim/combat.ts';
import { previewAction } from '../../src/sim/forecast.ts';
import { actorId, cardId } from '../../src/sim/ids.ts';
import { createRng } from '../../src/sim/rng.ts';
import { findActor, type CombatState } from '../../src/sim/state.ts';
import { tick } from '../../src/sim/tick.ts';
import { poiseLine } from '../../src/ui/EnemyLine.ts';
import { MUTED, PLAYER_INK } from '../../src/ui/theme.ts';

const CATALOGUE = m0Catalogue();

function opening(deck: readonly string[]): CombatState {
  return advanceToDecision(
    startCombat({
      actors: ratAndWarden(),
      catalogue: CATALOGUE,
      deck: deck.map(cardId),
      rng: createRng(1, 'combat'),
    }).state,
  ).state;
}

function actor(state: CombatState, id: ReturnType<typeof actorId>): Actor {
  const found = findActor(state, id);
  if (found === undefined) throw new Error(`no actor ${String(id)}`);
  return found;
}

/**
 * Gate question: "I can't see if an enemy will be staggered or not. Also what
 * the Poise X means" (docs/M0_GATE.md §5). Both halves are this one line.
 */
describe("the enemy's Poise line (GDD §4.6)", () => {
  it('says what a hit has to clear, not just a bare number', () => {
    const state = opening(['crush']);
    const rat = actor(state, RAT);

    expect(poiseLine(rat, null)).toEqual({
      text: `POISE ${String(rat.poise)} · one hit of ${String(rat.poise)}+`,
      color: MUTED,
    });
  });

  it('names the Stagger on the enemy that takes it, and only that one', () => {
    const state = opening(['crush']);
    const preview = previewAction(state, { kind: 'play', card: cardId('crush'), target: RAT });
    if (preview === null) throw new Error('crush should be legal');

    // Crush is 24 against the rat's Poise 7, so the first Stagger is the full 3.
    expect(poiseLine(actor(state, RAT), preview)).toEqual({
      text: 'STAGGER +3 ticks',
      color: PLAYER_INK,
    });
    // The Warden is untouched by that card, so its line stays the threshold.
    expect(poiseLine(actor(state, WARDEN), preview)?.color).toBe(MUTED);
  });

  it('keeps the threshold when the hovered card falls short of it', () => {
    const state = opening(['sweep']);
    const preview = previewAction(state, { kind: 'play', card: cardId('sweep'), target: RAT });
    if (preview === null) throw new Error('sweep should be legal');

    // Sweep deals 6 to each into Poise 8. Chip never staggers (GDD §4.6 [AMD]).
    expect(preview.staggers).toEqual([]);
    expect(poiseLine(actor(state, RAT), preview)?.text).toContain('POISE');
  });

  it('prints the threshold Brittle actually moved, not the printed one', () => {
    const state = opening(['crush']);
    const rat = actor(state, RAT);
    const brittle: Actor = {
      ...rat,
      statuses: [{ kind: 'brittle', magnitude: 3, expiresAt: tick(99), nextProcAt: null }],
    };

    expect(poiseLine(brittle, null)?.text).toBe(
      `POISE ${String(rat.poise - 3)} · one hit of ${String(rat.poise - 3)}+`,
    );
  });

  it('says nothing for an actor no hit can stagger', () => {
    const state = opening(['crush']);
    expect(actor(state, PLAYER).poise).toBe(0);
    expect(poiseLine(actor(state, PLAYER), null)).toBeNull();
  });
});
