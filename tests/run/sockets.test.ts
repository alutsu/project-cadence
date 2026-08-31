import { describe, expect, it } from 'vitest';
import {
  craft,
  maxHpFloor,
  openSocket,
  reroll,
  seat,
  SIGNATURE_CARD,
  startRun,
  unseat,
  type RunState,
} from '../../src/run/RunState.ts';
import {
  attemptSocket,
  MAX_SOCKETS,
  SCAR_SURCHARGE,
  SOCKET_COSTS,
  SOCKET_ODDS,
  socketPrice,
  socketRefusal,
} from '../../src/run/socket.ts';
import {
  canUpgrade,
  grantMaterial,
  NO_MATERIALS,
  UPGRADE_COST,
  upgradeMaterial,
} from '../../src/run/materials.ts';
import { craftGem, rerollValues } from '../../src/run/forge.ts';
import { NO_SOCKETS, type GemTier } from '../../src/sim/gem.ts';
import { cardId } from '../../src/sim/ids.ts';
import { createRng } from '../../src/sim/rng.ts';

/**
 * Sockets and crafting (GDD §6.1, §6.2).
 *
 * The floor is the load-bearing rule here. §6.1 added it to stop a death-spiral
 * build that cannot survive a boss hit and to stop an unwinnable-state
 * softlock — so it is asserted as a property over many random sequences rather
 * than at the two or three points a hand-written case would reach.
 */

const LUNGE = cardId('lunge');

/** One attempt on the deck's nth card, flattened so the loop stays shallow. */
function attemptOn(
  run: RunState,
  attempt: number,
): { readonly run: RunState; readonly refused: boolean } {
  const card = run.deck[attempt % run.deck.length];
  if (card === undefined) return { run, refused: false };

  const result = openSocket(run, card);
  return result.ok ? { run: result.run, refused: false } : { run, refused: true };
}

function stocked(seed: number, materials = 12, insight = 12): RunState {
  const run = startRun(seed);
  return {
    ...run,
    materials: { 1: materials, 2: materials, 3: materials, 4: materials },
    insight,
  };
}

describe('what a socket costs (GDD §6.1)', () => {
  it('charges 8, 12 and 18 percent of Max HP in order', () => {
    const query = { maxHp: 100, floor: 0, insight: 9, sockets: NO_SOCKETS };

    expect(socketPrice(query)?.maxHp).toBe(8);
    expect(socketPrice({ ...query, sockets: { ...NO_SOCKETS, opened: 1 } })?.maxHp).toBe(12);
    expect(socketPrice({ ...query, sockets: { ...NO_SOCKETS, opened: 2 } })?.maxHp).toBe(18);
  });

  it('charges maximum HP, so healing cannot refund it', () => {
    // The query has no notion of current HP at all — that is the point (§6.1).
    const price = socketPrice({ maxHp: 50, floor: 0, insight: 9, sockets: NO_SOCKETS });
    expect(price?.maxHp).toBe(Math.ceil(50 * 0.08));
  });

  it('offers no fourth socket', () => {
    const full = { ...NO_SOCKETS, opened: MAX_SOCKETS };
    expect(socketPrice({ maxHp: 100, floor: 0, insight: 9, sockets: full })).toBeNull();
    expect(socketRefusal({ maxHp: 100, floor: 0, insight: 9, sockets: full })).toEqual({
      reason: 'no_socket_left',
    });
  });

  it('asks for Insight on the third and only the third (§6.1, §8)', () => {
    const at = (opened: number): number =>
      socketPrice({ maxHp: 100, floor: 0, insight: 9, sockets: { ...NO_SOCKETS, opened } })
        ?.insight ?? -1;

    expect([at(0), at(1), at(2)]).toEqual([0, 0, 1]);
  });

  it('adds half again on a scarred card, and never more (§6.1)', () => {
    const scarred = { ...NO_SOCKETS, scarred: true };
    const price = socketPrice({ maxHp: 100, floor: 0, insight: 9, sockets: scarred });

    const firstShare = SOCKET_COSTS[0] ?? 0;
    expect(price?.maxHp).toBe(Math.ceil(100 * firstShare * (1 + SCAR_SURCHARGE)));
  });
});

describe('the Max HP floor holds (GDD §6.1 [NEW])', () => {
  it('never lets Max HP fall below 40% of the baseline, over 10,000 sequences', () => {
    let lowest = Number.POSITIVE_INFINITY;
    let refusals = 0;

    for (let seed = 0; seed < 10_000; seed += 1) {
      let run = stocked(seed, 40, 40);
      const floor = maxHpFloor(run);

      // Hammer every card in the deck until nothing more can be opened.
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const result = attemptOn(run, attempt);
        run = result.run;
        refusals += result.refused ? 1 : 0;
      }

      expect(run.maxHp).toBeGreaterThanOrEqual(floor);
      expect(run.hp).toBeLessThanOrEqual(run.maxHp);
      lowest = Math.min(lowest, run.maxHp);
    }

    // The floor is reachable, or the property proves nothing.
    expect(lowest).toBeLessThan(startRun(0).maxHp);
    expect(refusals).toBeGreaterThan(0);
  });

  it('refuses the attempt rather than clamping after the fact', () => {
    const query = { maxHp: 30, floor: 28, insight: 9, sockets: NO_SOCKETS };

    expect(socketRefusal(query)).toEqual({ reason: 'would_breach_floor', floor: 28 });
    expect(attemptSocket(query, createRng(1, 'gemRoll'))).toEqual({
      reason: 'would_breach_floor',
      floor: 28,
    });
  });

  it('refuses a third socket with no Insight to pay for it', () => {
    const query = { maxHp: 100, floor: 0, insight: 0, sockets: { ...NO_SOCKETS, opened: 2 } };
    expect(socketRefusal(query)).toEqual({ reason: 'not_enough_insight', needed: 1 });
  });
});

describe('a failed attempt (GDD §6.1)', () => {
  it('spends the HP, opens nothing, and Scars the card', () => {
    // The second socket is 75%, so a failure is findable.
    const query = { maxHp: 100, floor: 0, insight: 9, sockets: { ...NO_SOCKETS, opened: 1 } };
    const failure = Array.from({ length: 60 }, (_, seed) =>
      attemptSocket(query, createRng(seed, 'gemRoll')),
    ).find((result) => 'opened' in result && !result.opened);

    if (failure === undefined || !('opened' in failure)) throw new Error('no failure found');
    expect(failure.opened).toBe(false);
    expect(failure.sockets.opened).toBe(1);
    expect(failure.maxHp).toBe(88);
    expect(failure.sockets.scarred).toBe(true);
  });

  it('sets Scarred once and never twice — it is a flag, not a tally', () => {
    const scarred = { ...NO_SOCKETS, opened: 1, scarred: true };
    const query = { maxHp: 100, floor: 0, insight: 9, sockets: scarred };
    const priceOnce = socketPrice(query)?.maxHp ?? 0;

    const again = Array.from({ length: 60 }, (_, seed) =>
      attemptSocket(query, createRng(seed, 'gemRoll')),
    ).find((result) => 'opened' in result && !result.opened);

    if (again === undefined || !('opened' in again)) throw new Error('no failure found');
    expect(again.sockets.scarred).toBe(true);
    expect(again.price.maxHp).toBe(priceOnce);
  });

  it('always succeeds on the first socket, which §6.1 puts at 100%', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const result = attemptSocket(
        { maxHp: 100, floor: 0, insight: 9, sockets: NO_SOCKETS },
        createRng(seed, 'gemRoll'),
      );
      expect('opened' in result && result.opened).toBe(true);
    }
    expect(SOCKET_ODDS[0]).toBe(1);
  });
});

describe('the run starts with one socket open (GDD §6.1)', () => {
  it('opens it on the signature card, so Depth 1 has gem play', () => {
    const run = startRun(1);
    expect(run.build.sockets[SIGNATURE_CARD]?.opened).toBe(1);
    expect(run.deck).toContain(SIGNATURE_CARD);
  });
});

describe('crafting is generative (GDD §6.2)', () => {
  it('spends a material of the tier it crafts at', () => {
    const run = stocked(2, 1);
    const made = craft(run, { frame: 'REPEAT', tier: 2 });
    if (!made.ok) throw new Error(made.reason);

    expect(made.run.materials[2]).toBe(0);
    expect(made.run.materials[1]).toBe(1);
    expect(made.run.pouch).toContain(made.value);
  });

  it('refuses a craft with no material for it', () => {
    const run = { ...startRun(2), materials: NO_MATERIALS };
    expect(craft(run, { frame: 'REPEAT', tier: 1 }).ok).toBe(false);
  });

  it('rolls the same gem for the same seed, and a different one for another', () => {
    const one = craftGem({ frame: 'BREAK', tier: 3, serial: 0 }, createRng(4, 'gemRoll'));
    const same = craftGem({ frame: 'BREAK', tier: 3, serial: 0 }, createRng(4, 'gemRoll'));
    const other = craftGem({ frame: 'BREAK', tier: 3, serial: 0 }, createRng(5, 'gemRoll'));

    expect(one).toEqual(same);
    expect(one.effects).not.toEqual(other.effects);
  });

  it('rolls higher tiers into stronger ranges', () => {
    const strengthOf = (tier: GemTier): number => {
      const gem = craftGem({ frame: 'WARD', tier, serial: 0 }, createRng(9, 'gemRoll'));
      return gem.effects.find((effect) => effect.type === 'GUARD_GAIN')?.value ?? 0;
    };

    expect(strengthOf(4)).toBeGreaterThan(strengthOf(1));
  });

  it('gives KINDLE a real tag rather than a magnitude', () => {
    const gem = craftGem({ frame: 'KINDLE', tier: 1, serial: 0 }, createRng(3, 'gemRoll'));
    expect(gem.effects.find((effect) => effect.type === 'CONVERT_TAG')?.tag).not.toBeNull();
  });
});

describe('rerolling buys numbers, not a frame (GDD §6.2, §22 Q4)', () => {
  it('keeps the frame and tier, and moves the values', () => {
    const gem = craftGem({ frame: 'HASTE', tier: 2, serial: 0 }, createRng(1, 'gemRoll'));
    const again = rerollValues(gem, createRng(77, 'gemRoll'));

    expect(again.frame).toBe(gem.frame);
    expect(again.tier).toBe(gem.tier);
    expect(again.id).toBe(gem.id);
    expect(again.effects).not.toEqual(gem.effects);
  });

  it('costs Insight, and is refused without it', () => {
    const run = stocked(6, 4, 1);
    const made = craft(run, { frame: 'SIPHON', tier: 1 });
    if (!made.ok) throw new Error(made.reason);

    const once = reroll(made.run, made.value);
    if (!once.ok) throw new Error(once.reason);

    expect(once.run.insight).toBe(0);
    expect(reroll(once.run, made.value).ok).toBe(false);
  });
});

describe('seating and removing (GDD §6.2)', () => {
  it('seats a crafted gem into an open socket', () => {
    const run = stocked(8);
    const made = craft(run, { frame: 'WARD', tier: 1 });
    if (!made.ok) throw new Error(made.reason);

    const seated = seat(made.run, SIGNATURE_CARD, made.value);
    if (!seated.ok) throw new Error(seated.reason);

    expect(seated.run.build.sockets[SIGNATURE_CARD]?.gems).toEqual([made.value]);
    expect(seated.run.pouch).not.toContain(made.value);
  });

  it('refuses a card with no open socket', () => {
    const run = stocked(8);
    const made = craft(run, { frame: 'WARD', tier: 1 });
    if (!made.ok) throw new Error(made.reason);

    expect(seat(made.run, LUNGE, made.value).ok).toBe(false);
  });

  it('destroys the gem on removal — it does not go back in the pouch', () => {
    const run = stocked(8);
    const made = craft(run, { frame: 'WARD', tier: 1 });
    if (!made.ok) throw new Error(made.reason);
    const seated = seat(made.run, SIGNATURE_CARD, made.value);
    if (!seated.ok) throw new Error(seated.reason);

    const removed = unseat(seated.run, SIGNATURE_CARD, made.value);
    if (!removed.ok) throw new Error(removed.reason);

    expect(removed.run.build.sockets[SIGNATURE_CARD]?.gems).toEqual([]);
    expect(removed.run.build.sockets[SIGNATURE_CARD]?.opened).toBe(1);
    expect(removed.run.pouch).not.toContain(made.value);
    expect(removed.run.build.gems[made.value]).toBeUndefined();
  });
});

describe('the material ladder (GDD §9)', () => {
  it('turns three of a tier into one of the next', () => {
    let materials = NO_MATERIALS;
    for (let held = 0; held < UPGRADE_COST; held += 1) materials = grantMaterial(materials, 1);

    expect(canUpgrade(materials, 1)).toBe(true);
    const upgraded = upgradeMaterial(materials, 1);
    expect(upgraded[1]).toBe(0);
    expect(upgraded[2]).toBe(1);
  });

  it('will not upgrade past the top of the ladder', () => {
    const rich = { 1: 9, 2: 9, 3: 9, 4: 9 };
    expect(canUpgrade(rich, 4)).toBe(false);
    expect(upgradeMaterial(rich, 4)).toEqual(rich);
  });

  it('will not upgrade on two of a tier', () => {
    const two = { ...NO_MATERIALS, 1: 2 };
    expect(canUpgrade(two, 1)).toBe(false);
  });
});

describe('crafting never disturbs the fight (GDD §20.2)', () => {
  it('leaves the combat stream where it found it', () => {
    const run = stocked(12);
    const made = craft(run, { frame: 'REPEAT', tier: 1 });
    if (!made.ok) throw new Error(made.reason);
    const opened = openSocket(made.run, LUNGE);
    if (!opened.ok) throw new Error(opened.reason);

    expect(opened.run.streams.combat).toEqual(run.streams.combat);
    expect(opened.run.streams.weave).toEqual(run.streams.weave);
    expect(opened.run.streams.gemRoll.position).toBeGreaterThan(run.streams.gemRoll.position);
  });
});
