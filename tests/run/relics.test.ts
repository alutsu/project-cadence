import { describe, expect, it } from 'vitest';
import { parseRelicTable, relicTable } from '../../src/data/relics.ts';
import { leversFor, offerRelics, RELIC_CHOICES, takeRelic } from '../../src/run/relics.ts';
import {
  absorbEncounter,
  combatRulesFor,
  socketQueryFor,
  startRun,
  weaveSnapshot,
  type RunState,
} from '../../src/run/RunState.ts';
import { socketPrice } from '../../src/run/socket.ts';
import { createRng } from '../../src/sim/rng.ts';
import { ATTUNEMENT_TABLE } from '../../src/sim/weave.ts';
import { SATURATION_CAP } from '../../src/sim/saturation.ts';

function holding(seed: number, relics: readonly string[]): RunState {
  const run = startRun(seed);
  const first = run.map.depths[0]?.offered[0];
  if (first === undefined) throw new Error('the map offers no node');
  return { ...run, relics, position: { ...run.position, node: first.id } };
}

describe('the relic table (GDD §10)', () => {
  it('holds §10 authored relics, each with a real drawback', () => {
    const table = relicTable();
    expect(Object.keys(table).length).toBeGreaterThanOrEqual(8);

    for (const relic of Object.values(table)) {
      expect(relic.gain.length).toBeGreaterThan(0);
      // §10: "Every relic should carry a real drawback. Pure upgrades create a
      // known-correct relic ranking, which is exactly the meta this design
      // exists to avoid."
      expect(relic.drawback.length).toBeGreaterThan(0);
      expect(relic.atoms.length).toBeGreaterThan(0);
    }
  });

  it('refuses a relic with no drawback', () => {
    const parsed = parseRelicTable({
      relics: [
        {
          id: 'freebie',
          name: 'Freebie',
          category: 'Risk',
          gain: 'pure upside',
          drawback: '',
          atoms: [{ type: 'GUARD_GAIN', value: 5 }],
        },
      ],
    });

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.join()).toContain('drawback');
  });

  it('refuses a relic asking for a lever nobody built', () => {
    const parsed = parseRelicTable({
      relics: [
        {
          id: 'wishful',
          name: 'Wishful',
          category: 'Risk',
          gain: 'something new',
          drawback: 'something else',
          atoms: [{ type: 'REWRITE_THE_RULES', value: 1 }],
        },
      ],
    });

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.join()).toContain('REWRITE_THE_RULES');
  });
});

describe('each relic does what its card says (GDD §10)', () => {
  it('Second Wind — the Guard action draws 2 and puts up 1 less', () => {
    const base = combatRulesFor(holding(2, []));
    const held = combatRulesFor(holding(2, ['second_wind']));

    expect(held.guardDraw).toBe(base.guardDraw + 1);
    expect(held.guardGain).toBe(base.guardGain - 1);
  });

  it('Undertow — Stagger lasts a tick longer, and the player is slower', () => {
    const base = holding(2, []);
    const held = holding(2, ['undertow']);

    expect(combatRulesFor(held).firstStagger).toBe(combatRulesFor(base).firstStagger + 1);
    expect(leversFor(held.relics).speedDelta).toBe(-10);
  });

  it('Prism — Suppressed only falls to 0.85, Ascendant only rises to 1.15', () => {
    const profiles = weaveSnapshot(holding(2, ['prism'])).profiles;
    expect(profiles?.suppressed.multiplier).toBe(0.85);
    expect(profiles?.ascendant.multiplier).toBe(1.15);
    // §7.1's Weight rider is untouched — no relic in §10 moves it.
    expect(profiles?.suppressed.weightDelta).toBe(ATTUNEMENT_TABLE.suppressed.weightDelta);
  });

  it("Zealot's Blinders — Ascendant reaches 1.7 and Saturation reaches 50%", () => {
    const held = holding(2, ['zealots_blinders']);
    expect(weaveSnapshot(held).profiles?.ascendant.multiplier).toBe(1.7);
    expect(leversFor(held.relics).saturationCap).toBe(0.5);

    // The published cap is what an unrelicked run still gets.
    expect(leversFor([]).saturationCap).toBeNull();
    expect(SATURATION_CAP).toBe(0.3);
  });

  it('holding Prism and Zealot at once takes the worse Ascendant, not the later one', () => {
    const both = weaveSnapshot(holding(2, ['zealots_blinders', 'prism'])).profiles;
    const reversed = weaveSnapshot(holding(2, ['prism', 'zealots_blinders'])).profiles;

    expect(both?.ascendant.multiplier).toBe(1.15);
    expect(reversed?.ascendant.multiplier).toBe(1.15);
  });

  it('Bone Ledger — a socket costs 4 percentage points less Max HP', () => {
    const base = holding(2, []);
    const held = holding(2, ['bone_ledger']);
    const card = base.deck[0];
    if (card === undefined) return;

    const cheap = socketPrice(socketQueryFor(held, card));
    const full = socketPrice(socketQueryFor(base, card));
    expect(cheap).not.toBeNull();
    expect(full).not.toBeNull();
    if (cheap === null || full === null) return;

    expect(cheap.maxHp).toBeLessThan(full.maxHp);
    // 8% of 70 is 6; 4% of 70 is 3. The discount is the share, not the total.
    expect(full.maxHp - cheap.maxHp).toBe(
      Math.ceil(base.maxHp * 0.08) - Math.ceil(base.maxHp * 0.04),
    );
  });

  it('Glass Sigil — damage moves in both directions', () => {
    const levers = leversFor(['glass_sigil']);
    expect(levers.damageDealtMult).toBeCloseTo(1.3);
    expect(levers.damageTakenMult).toBeCloseTo(1.3);
  });

  it('Metronome — the first action is free and the rest cost more', () => {
    const levers = leversFor(['metronome']);
    expect(levers.freeFirstWeight).toBe(true);
    expect(levers.weightDelta).toBe(1);
  });

  it("Prospector's Eye — an elite pays a tier higher, and all gold is cut", () => {
    const levers = leversFor(['prospectors_eye']);
    expect(levers.eliteMaterialTier).toBe(1);
    expect(levers.goldMult).toBeCloseTo(0.8);
  });

  it("Prospector's Eye takes its cut of real gold, and never below zero", () => {
    const plain = absorbEncounter(holding(7, []), {
      outcome: 'won',
      hp: 40,
      events: [],
      baseXp: 10,
    });
    const cut = absorbEncounter(holding(7, ['prospectors_eye']), {
      outcome: 'won',
      hp: 40,
      events: [],
      baseXp: 10,
    });

    expect(cut.gold).toBeLessThan(plain.gold);
    expect(cut.gold).toBeGreaterThan(0);
  });
});

describe('acquiring relics (GDD §10)', () => {
  it('offers two, and never one already held', () => {
    const first = offerRelics([], createRng(3, 'reward'));
    expect(first.length).toBe(RELIC_CHOICES);
    expect(new Set(first).size).toBe(RELIC_CHOICES);

    const held = Object.keys(relicTable()).slice(0, 6);
    for (const id of offerRelics(held, createRng(3, 'reward'))) {
      expect(held).not.toContain(id);
    }
  });

  /** D32: the draw count cannot depend on what happens to be held. */
  it('draws the same number of times whatever is held', () => {
    const empty = createRng(5, 'reward');
    offerRelics([], empty);

    const loaded = createRng(5, 'reward');
    offerRelics(Object.keys(relicTable()).slice(0, 4), loaded);

    expect(empty.state().position).toBe(loaded.state().position);
  });

  it('holding a relic twice means holding it once', () => {
    expect(takeRelic(['prism'], 'prism')).toEqual(['prism']);
    expect(takeRelic(['prism'], 'undertow')).toEqual(['prism', 'undertow']);
  });
});
