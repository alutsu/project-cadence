import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/sim/rng.ts';
import {
  MATERIAL_PRICES,
  REMOVAL_LADDER,
  removalPrice,
  rollReward,
  type RewardKind,
} from '../../src/run/economy.ts';
import { buyMaterial, DECK_FLOOR, removeCard } from '../../src/run/market.ts';
import {
  absorbEncounter,
  SIGNATURE_CARD,
  startRun,
  type RunState,
} from '../../src/run/RunState.ts';
import { cardId } from '../../src/sim/ids.ts';

const KINDS: readonly RewardKind[] = ['normal', 'elite', 'boss'];

/** A reward is priced by the node it was won in, so the run has to be in one. */
function enteredFirstNode(run: RunState): RunState {
  const first = run.map.depths[0]?.offered[0];
  if (first === undefined) throw new Error('the map offers no node');
  return { ...run, position: { ...run.position, node: first.id } };
}

describe("§9's sources", () => {
  it('pays gold inside the published band for every kind', () => {
    const bands: Readonly<Record<RewardKind, readonly [number, number]>> = {
      normal: [15, 25],
      elite: [40, 60],
      boss: [100, 140],
    };

    for (const kind of KINDS) {
      const [low, high] = bands[kind];
      const rng = createRng(11, 'reward');
      for (let i = 0; i < 400; i += 1) {
        const gold = rollReward(kind, rng).gold;
        expect(gold).toBeGreaterThanOrEqual(low);
        expect(gold).toBeLessThanOrEqual(high);
      }
    }
  });

  it('drops the tier its row names, and only sometimes for a normal fight', () => {
    const tally = { dropped: 0, total: 600 };
    const rng = createRng(4, 'reward');
    for (let i = 0; i < tally.total; i += 1) {
      if (rollReward('normal', rng).material !== null) tally.dropped += 1;
    }
    // §9: 35% chance of a T1. Loose bounds — this asserts the rate is the one
    // published, not that the PRNG is fair.
    expect(tally.dropped / tally.total).toBeGreaterThan(0.28);
    expect(tally.dropped / tally.total).toBeLessThan(0.42);

    const elite = rollReward('elite', createRng(4, 'reward'));
    const boss = rollReward('boss', createRng(4, 'reward'));
    expect(elite.material).toBe(2);
    expect(boss.material).toBe(3);
    expect(boss.insight).toBe(1);
    expect(elite.insight).toBe(0);
  });

  /**
   * D32's fixed-draw rule. A guaranteed material still rolls its chance, so the
   * stream lands in the same place whatever the row — otherwise the position
   * encodes the outcome and a resumed run diverges.
   */
  it('draws the same number of times whatever it pays', () => {
    const positions = KINDS.map((kind) => {
      const rng = createRng(9, 'reward');
      rollReward(kind, rng);
      return rng.state().position;
    });

    expect(new Set(positions).size).toBe(1);
  });
});

describe("§9's sinks", () => {
  it('escalates removal 60 → 120 → 240 → 480 and then refuses', () => {
    expect(REMOVAL_LADDER).toEqual([60, 120, 240, 480]);
    expect(REMOVAL_LADDER.map((_, spent) => removalPrice(spent))).toEqual(REMOVAL_LADDER);
    expect(removalPrice(REMOVAL_LADDER.length)).toBeNull();
  });

  it('prices materials at 40 / 90 / 200 and never sells a Sigil', () => {
    expect(MATERIAL_PRICES).toEqual({ 1: 40, 2: 90, 3: 200 });

    const rich: RunState = { ...startRun(2), gold: 1000 };
    expect(buyMaterial(rich, 4)).toMatchObject({ ok: false, refusal: { reason: 'no-price' } });

    const bought = buyMaterial(rich, 2);
    expect(bought.ok).toBe(true);
    if (!bought.ok) return;
    expect(bought.run.gold).toBe(1000 - 90);
    expect(bought.run.materials[2]).toBe(rich.materials[2] + 1);
  });

  it('refuses a purchase the wallet cannot cover, and takes nothing', () => {
    const poor: RunState = { ...startRun(2), gold: 39 };
    expect(buyMaterial(poor, 1)).toMatchObject({ ok: false, refusal: { reason: 'too-poor' } });
  });
});

describe('card removal', () => {
  const wealthy = (): RunState => ({ ...startRun(5), gold: 2000 });

  it('charges the ladder and thins one copy', () => {
    const run = wealthy();
    const victim = run.deck.find((card) => card !== SIGNATURE_CARD);
    expect(victim).toBeDefined();
    if (victim === undefined) return;

    const removed = removeCard(run, victim);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;

    expect(removed.run.gold).toBe(2000 - 60);
    expect(removed.run.removals).toBe(1);
    expect(removed.run.deck.length).toBe(run.deck.length - 1);
    // One copy, not all of them.
    const before = run.deck.filter((card) => card === victim).length;
    expect(removed.run.deck.filter((card) => card === victim).length).toBe(before - 1);
  });

  it('never removes the signature, which carries the opening socket (§6.1)', () => {
    expect(removeCard(wealthy(), SIGNATURE_CARD)).toMatchObject({
      ok: false,
      refusal: { reason: 'signature' },
    });
  });

  it('refuses a card the deck does not hold', () => {
    expect(removeCard(wealthy(), cardId('not_a_card'))).toMatchObject({
      ok: false,
      refusal: { reason: 'not-in-deck' },
    });
  });

  it('will not thin the deck below its floor', () => {
    let run = wealthy();
    // Strip down to the floor, then ask for one more.
    for (let guard = 0; guard < 20 && run.deck.length > DECK_FLOOR; guard += 1) {
      const victim = run.deck.find((card) => card !== SIGNATURE_CARD);
      if (victim === undefined) break;
      const step = removeCard(run, victim);
      if (!step.ok) break;
      run = step.run;
    }

    expect(run.deck.length).toBeGreaterThanOrEqual(DECK_FLOOR);
    const victim = run.deck.find((card) => card !== SIGNATURE_CARD);
    if (victim === undefined) return;
    const refused = removeCard(run, victim);
    expect(refused.ok).toBe(false);
  });
});

describe('the ledger reaches the run', () => {
  /**
   * The tables are only worth having if clearing a fight actually pays them.
   * `absorbEncounter` used to grant a material on every clear and no gold at
   * all, because there was no gold — this is the test that says there is.
   */
  it('pays gold into the run when an encounter is cleared', () => {
    const run = enteredFirstNode(startRun(21));
    const after = absorbEncounter(run, {
      outcome: 'won',
      hp: run.hp,
      events: [],
      baseXp: 10,
    });

    expect(after.gold).toBeGreaterThanOrEqual(15);
    expect(after.gold).toBeLessThanOrEqual(25);
  });

  it('pays nothing for a fight that was lost', () => {
    const run = enteredFirstNode(startRun(21));
    const after = absorbEncounter(run, { outcome: 'lost', hp: 0, events: [], baseXp: 10 });
    expect(after.gold).toBe(0);
  });

  it('leaves every other stream where it found it', () => {
    const run = enteredFirstNode(startRun(21));
    const after = absorbEncounter(run, {
      outcome: 'won',
      hp: run.hp,
      events: [],
      baseXp: 10,
    });

    for (const name of ['map', 'gemRoll', 'enemyGen', 'combat'] as const) {
      expect(after.streams[name].position).toBe(run.streams[name].position);
    }
    expect(after.streams.reward.position).toBeGreaterThan(run.streams.reward.position);
  });
});

describe('removing a card takes its build with it', () => {
  it('keeps the sockets while another copy of the card remains', () => {
    const base = { ...startRun(31), gold: 2000 };
    const repeated = base.deck.find((card) => base.deck.filter((held) => held === card).length > 1);
    if (repeated === undefined) return;

    const removed = removeCard(base, repeated);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    // The socket record is shared between copies; stripping it while one is
    // still in the deck would silently un-socket a card still in play.
    expect(removed.run.build.sockets).toEqual(base.build.sockets);
  });

  it('drops the sockets and gems when the last copy goes', () => {
    const base = { ...startRun(31), gold: 2000 };
    const lone = base.deck.find(
      (card) => card !== SIGNATURE_CARD && base.deck.filter((held) => held === card).length === 1,
    );
    if (lone === undefined) return;

    const withSocket = {
      ...base,
      build: {
        ...base.build,
        sockets: { ...base.build.sockets, [lone]: { opened: 1, gems: [], scarred: false } },
      },
    };

    const removed = removeCard(withSocket, lone);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.run.build.sockets[lone]).toBeUndefined();
  });
});
