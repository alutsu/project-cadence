import { describe, expect, it } from 'vitest';
import {
  depthMapAt,
  digestOf,
  generateMap,
  DEPTH_COUNT,
  DUNGEONS_PER_DEPTH,
  NODES_TAKEN_PER_DEPTH,
} from '../../src/run/map.ts';
import {
  advanceRun,
  levelOf,
  viewOf,
  type RunIntent,
  type RunView,
} from '../../src/run/runFlow.ts';
import { restartRun, startRun, type RunState } from '../../src/run/RunState.ts';
import { createRng } from '../../src/sim/rng.ts';
import { bossFor } from '../../src/data/bosses.ts';
import { TAGS } from '../../src/sim/tag.ts';

/**
 * The map (GDD §11) and the flow over it.
 *
 * The load-bearing property is reproducibility: the whole map is drawn at run
 * start, so the `map` stream's position cannot depend on the route taken. A
 * position that depended on its own outcome could not be resumed from a save
 * (§20.2 [AMD]), and the run would quietly be in a different world.
 */

function intentFor(view: RunView): RunIntent {
  if (view.kind === 'map') {
    const node = view.offered[0];
    if (node === undefined) throw new Error('a Depth offered nothing');
    return { kind: 'enterNode', node: node.id };
  }
  if (view.kind === 'sanctum') return { kind: 'rest' };
  if (view.kind === 'market') return { kind: 'leaveNode' };
  return {
    kind: 'finishEncounter',
    result: { won: true, hp: 40, events: [], ticks: 20, hpOnEntry: 70 },
  };
}

/** A whole run, winning everything, taking the first thing offered. */
function walk(seed: number): { readonly run: RunState; readonly views: readonly RunView[] } {
  let run = startRun(seed);
  const views: RunView[] = [];

  for (let step = 0; step < 400; step += 1) {
    const view = viewOf(run);
    views.push(view);
    if (view.kind === 'summary') break;
    run = advanceRun(run, intentFor(view)).run;
  }

  return { run, views };
}

describe('the map is laid out once, from the seed (GDD §11, §20.2)', () => {
  it('gives four Depths, each offering two Dungeons, a Sanctum and a Market', () => {
    const map = generateMap(createRng(5, 'map'));
    expect(map.depths).toHaveLength(DEPTH_COUNT);

    for (const depth of map.depths) {
      const kinds = depth.offered.map((node) => node.kind);
      expect(kinds.filter((kind) => kind === 'dungeon')).toHaveLength(DUNGEONS_PER_DEPTH);
      expect(kinds.filter((kind) => kind === 'sanctum')).toHaveLength(1);
      expect(kinds.filter((kind) => kind === 'market')).toHaveLength(1);
      expect(depth.boss.kind).toBe('boss');
    }
  });

  it('draws a fixed number of times whatever it rolls', () => {
    // §20.2 [AMD]: rejection sampling would make the position depend on the
    // outcome, and a save could not resume into the same world.
    const positions = Array.from({ length: 200 }, (_, seed) => {
      const rng = createRng(seed, 'map');
      generateMap(rng);
      return rng.state().position;
    });

    expect(new Set(positions).size).toBe(1);
  });

  it('is the same map for the same seed', () => {
    expect(generateMap(createRng(9, 'map'))).toEqual(generateMap(createRng(9, 'map')));
    expect(generateMap(createRng(9, 'map'))).not.toEqual(generateMap(createRng(10, 'map')));
  });

  it('fingerprints a map, so a changed generator cannot resume silently (§16)', () => {
    const map = generateMap(createRng(3, 'map'));
    expect(digestOf(map)).toBe(digestOf(generateMap(createRng(3, 'map'))));
    expect(digestOf(map)).not.toBe(digestOf(generateMap(createRng(4, 'map'))));
  });

  it('puts hard immunity only on elites, and never on a boss (§7.2, §12.3)', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      for (const depth of generateMap(createRng(seed, 'map')).depths) {
        const immune = depth.offered.filter((node) => node.omen?.kind === 'immune');
        expect(immune.every((node) => node.elite)).toBe(true);
        expect(depth.boss.omen).toBeNull();
      }
    }
  });

  it('shows a Dungeon’s Threat rating and one Omen before it is entered (§11)', () => {
    for (const depth of generateMap(createRng(7, 'map')).depths) {
      for (const node of depth.offered.filter((entry) => entry.kind === 'dungeon')) {
        expect(node.rating).toBeGreaterThanOrEqual(0);
        expect(node.omen).not.toBeNull();
        expect(TAGS).toContain(node.omen?.tag);
      }
    }
  });
});

describe('the flow walks a whole run (GDD §11)', () => {
  it('reaches the summary from the first node, through four Depths', () => {
    const walked = walk(4242);

    expect(walked.views[walked.views.length - 1]).toEqual({ kind: 'summary', won: true });
    expect(walked.run.position.depth).toBe(DEPTH_COUNT + 1);
  });

  it('offers only the Boss once two nodes have been taken (§11)', () => {
    let run = startRun(11);
    const bosses: string[] = [];

    for (let step = 0; step < 400; step += 1) {
      const view = viewOf(run);
      if (view.kind === 'summary') break;
      if (view.kind === 'map' && run.position.taken.length >= NODES_TAKEN_PER_DEPTH) {
        expect(view.offered).toHaveLength(1);
        expect(view.offered[0]?.kind).toBe('boss');
        bosses.push(view.offered[0]?.id ?? '');
      }
      run = advanceRun(run, intentFor(view)).run;
    }

    expect(bosses).toHaveLength(DEPTH_COUNT);
  });

  it('never offers a node twice in one Depth', () => {
    let run = startRun(31);

    for (let step = 0; step < 400; step += 1) {
      const view = viewOf(run);
      if (view.kind === 'summary') break;
      if (view.kind === 'map') {
        const offered = view.offered.map((node) => node.id);
        expect(offered.filter((id) => run.position.taken.includes(id))).toEqual([]);
      }
      run = advanceRun(run, intentFor(view)).run;
    }
  });

  it('leaves the map stream where it started, whatever route is taken', () => {
    // The whole point of drawing at run start: the route cannot move it.
    expect(walk(19).run.streams.map).toEqual(startRun(19).streams.map);
    expect(walk(20).run.streams.map).toEqual(startRun(20).streams.map);
  });

  it('scales a node by its own rating and by the world’s Threat (§5.3)', () => {
    const run = startRun(8);
    const depth = depthMapAt(run.map, 1);
    const dungeon = depth.offered.find((node) => node.kind === 'dungeon');
    if (dungeon === undefined) throw new Error('no dungeon');

    const quiet = levelOf(run, dungeon);
    const busy = levelOf({ ...run, threat: 6 }, dungeon);

    expect(busy).toBe(quiet + 3);
  });
});

/**
 * A run that ended has to be able to start again (GDD §13).
 *
 * Found by playtest: `restartRun` hands back a run standing on the **map**, and
 * the scene then asked it for an encounter. It threw, the board stayed in its
 * dead state, and every further click recorded another run end — the log had
 * eight of them. The rule the fix encodes is below: a fresh run is on the map,
 * and something has to walk it to a fight before a fight can be asked for.
 */
describe('a fresh run stands on the map, not in a fight (GDD §11, §13)', () => {
  it('opens on the map, with nothing entered', () => {
    const run = startRun(77);

    expect(viewOf(run).kind).toBe('map');
    expect(run.position.node).toBeNull();
  });

  it('reaches an encounter once a node is entered, and not before', () => {
    let run = startRun(77);
    expect(viewOf(run).kind).toBe('map');

    const view = viewOf(run);
    if (view.kind !== 'map') throw new Error('expected the map');
    const dungeon = view.offered.find((node) => node.kind === 'dungeon');
    if (dungeon === undefined) throw new Error('no dungeon offered');

    run = advanceRun(run, { kind: 'enterNode', node: dungeon.id }).run;
    expect(viewOf(run).kind).toBe('encounter');
  });

  it('is on the map again after a death, ready to be walked forward', () => {
    let run = startRun(77);
    const view = viewOf(run);
    if (view.kind !== 'map') throw new Error('expected the map');
    const node = view.offered[0];
    if (node === undefined) throw new Error('nothing offered');

    run = advanceRun(run, { kind: 'enterNode', node: node.id }).run;
    const dead = advanceRun(run, {
      kind: 'finishEncounter',
      result: { won: false, hp: 0, events: [], ticks: 20, hpOnEntry: 70 },
    }).run;

    expect(viewOf(dead)).toEqual({ kind: 'summary', won: false });
    expect(viewOf(restartRun(dead)).kind).toBe('map');
  });
});

/**
 * §12.3's boss rules, asserted rather than trusted.
 *
 * Before `bosses.ts` existed a boss node generated like a Dungeon, and a
 * playtest met a lone Emberhide as the Depth-1 boss. §12.3 is explicit that each
 * boss attacks a different assumption, which is not something a budget can
 * express — so a boss is authored, and the two prohibitions §12.3 states are
 * checked at load rather than left as a comment for M3 to trip over.
 */
describe('a boss is authored, not generated (GDD §12.3)', () => {
  it('fields the Clockeater at a boss node, whatever the Depth', () => {
    let run = startRun(4242);

    for (let step = 0; step < 400; step += 1) {
      const view = viewOf(run);
      if (view.kind === 'summary') break;
      if (view.kind === 'encounter' && view.node.kind === 'boss') {
        const enemies = view.setup.actors.filter((actor) => actor.side === 'enemy');
        expect(enemies).toHaveLength(1);
        expect(enemies[0]?.name).toBe('The Clockeater');
        return;
      }
      run = advanceRun(run, intentFor(view)).run;
    }

    throw new Error('the run never reached a boss');
  });

  it('has a Poise a card can actually clear, so the Stagger puzzle exists', () => {
    // The failure this guards: a threshold above anything the deck can hit does
    // not make a hard fight, it makes an unavailable one. Two playtests met
    // exactly that, first from the Warden and then from a levelled Adept.
    const [boss] = bossFor(1, 0);
    if (boss === undefined) throw new Error('no boss');

    // A Standard card at level 1 lands 16 before the Weave; §12.3 asks the
    // Depth-1 boss to be beatable by any build.
    expect(boss.poise).toBeLessThan(16);
    expect(boss.poise).toBeGreaterThan(0);
  });

  it('carries no hard immunity, which §12.3 forbids outright', () => {
    for (const depth of [1, 2, 3, 4]) {
      const [boss] = bossFor(depth, depth * 2);
      for (const tag of TAGS) {
        expect(boss?.resistances?.[tag].kind).toBe('resist');
      }
    }
  });

  it('telegraphs a wind-up long enough to read eight slots out (§4.2, §12.3)', () => {
    const [boss] = bossFor(1, 0);
    const longest = Math.max(...(boss?.intents ?? []).map((intent) => intent.weight));

    expect(longest).toBeGreaterThan(16);
  });
});
