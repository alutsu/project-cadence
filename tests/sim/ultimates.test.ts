import { describe, expect, it } from 'vitest';
import { m0Catalogue } from '../../src/data/cards.ts';
import { PLAYER, RAT, soloRat } from '../../src/data/encounters.ts';
import { advanceToDecision, reduce, startCombat } from '../../src/sim/combat.ts';
import { cardId } from '../../src/sim/ids.ts';
import { createRng } from '../../src/sim/rng.ts';
import { DEFAULT_RULES, type UltimateRule } from '../../src/sim/rules.ts';
import { findActor, type CombatState } from '../../src/sim/state.ts';

const CATALOGUE = m0Catalogue();
const CATACLYSM = cardId('cataclysm');

function opened(ultimate: UltimateRule, ratHp = 200): CombatState {
  const started = startCombat({
    actors: soloRat(),
    catalogue: CATALOGUE,
    deck: [CATACLYSM],
    rng: createRng(1, 'combat'),
    rules: { ...DEFAULT_RULES, ultimate },
  });
  const opening = advanceToDecision(started.state).state;
  return {
    ...opening,
    actors: opening.actors.map((a) => (a.id === RAT ? { ...a, hp: ratHp, maxHp: ratHp } : a)),
  };
}

function playUltimate(state: CombatState) {
  const result = reduce(state, { kind: 'play', card: CATACLYSM, target: RAT });
  if (!result.ok) throw new Error(`cataclysm refused: ${result.error.reason}`);
  return result.step;
}

/**
 * GDD §22, open question 1. The three candidates exist side by side so the M0
 * feel hour can decide between them rather than the design guessing.
 */
describe('Ultimate rules (GDD §22 Q1)', () => {
  it('immediate: Weight 16 is paid up front — the baseline the question doubts', () => {
    const state = opened('immediate');
    const step = playUltimate(state);

    expect(findActor(step.state, PLAYER)?.nextActTick).toBe(state.now + 16);
    expect(findActor(step.state, RAT)?.hp).toBe(200 - 44);
  });

  it('windup: the blow is committed now and lands later, and you keep acting', () => {
    const state = opened('windup');
    const step = playUltimate(state);

    // The player is free again in four ticks, not sixteen.
    expect(findActor(step.state, PLAYER)?.nextActTick).toBe(state.now + 4);
    // Nothing has landed yet — it is in flight, and the queue can show it.
    expect(findActor(step.state, RAT)?.hp).toBe(200);
    expect(step.state.pending).toEqual([
      expect.objectContaining({ card: CATACLYSM, landsAt: state.now + 16, amount: 44 }),
    ]);
    expect(step.events).toContainEqual(
      expect.objectContaining({ kind: 'strike_committed', landsAt: state.now + 16 }),
    );
  });

  it('windup: the strike lands on the timeline, not on a turn', () => {
    const step = playUltimate(opened('windup'));
    const landsAt = step.state.pending[0]?.landsAt ?? 0;

    // Play on normally; sixteen ticks later the blow arrives on its own.
    let state = advanceToDecision(step.state).state;
    let landedEvent = false;
    while (state.now < landsAt && state.outcome === 'ongoing') {
      const waited = reduce(state, { kind: 'wait' });
      if (!waited.ok) break;
      const advanced = advanceToDecision(waited.step.state);
      landedEvent ||= advanced.events.some((event) => event.kind === 'strike_landed');
      state = advanced.state;
    }

    expect(landedEvent).toBe(true);
    expect(state.pending).toEqual([]);
    expect(findActor(state, RAT)?.hp).toBe(200 - 44);
  });

  it('refund: costs full Weight on a miss, half of it back on a kill', () => {
    const survives = playUltimate(opened('refund', 200));
    expect(findActor(survives.state, PLAYER)?.nextActTick).toBe(survives.state.now + 16);

    const kills = playUltimate(opened('refund', 20));
    expect(findActor(kills.state, PLAYER)?.nextActTick).toBe(kills.state.now + 8);
    expect(kills.events).toContainEqual(expect.objectContaining({ kind: 'actor_died' }));
  });

  it('leaves every non-Ultimate card alone under all three rules', () => {
    for (const rule of ['immediate', 'windup', 'refund'] as const) {
      const state = opened(rule);
      const withStrike = { ...state, hand: [cardId('strike')] };
      const result = reduce(withStrike, { kind: 'play', card: cardId('strike'), target: RAT });
      if (!result.ok) throw new Error('strike should be legal');

      expect(findActor(result.step.state, PLAYER)?.nextActTick).toBe(state.now + 4);
      expect(result.step.state.pending).toEqual([]);
    }
  });
});
