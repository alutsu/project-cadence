import { describe, expect, it } from 'vitest';
import { nodeLines, nodeSeat } from '../../src/ui/MapView.ts';
import { isRunSceneData } from '../../src/scenes/sceneData.ts';
import { generateMap } from '../../src/run/map.ts';
import { startRun } from '../../src/run/RunState.ts';
import { viewOf } from '../../src/run/runFlow.ts';
import { createRng } from '../../src/sim/rng.ts';
import { LAYOUT } from '../../src/ui/theme.ts';

/**
 * The map screen's pure parts (GDD §11).
 *
 * §11's argument is that node types "pay in **different currencies** (XP vs. HP
 * vs. gold), so they can't be ranked against each other — there's nothing to
 * solve". A card that printed a difficulty score would quietly undo that, so
 * what is asserted here is that each kind states its own currency and that a
 * Dungeon says only what §11 lets it say before you commit.
 */

const MAP = generateMap(createRng(4, 'map'));

function firstOf(kind: string) {
  const found = MAP.depths[0]?.offered.find((node) => node.kind === kind);
  if (found === undefined) throw new Error(`Depth 1 offers no ${kind}`);
  return found;
}

describe('a node card states what it pays (GDD §11)', () => {
  it('names a different currency for each kind', () => {
    expect(nodeLines({ node: firstOf('dungeon'), level: 2 })[0]).toBe('pays XP');
    expect(nodeLines({ node: firstOf('sanctum'), level: 0 })[0]).toBe('pays HP');
    expect(nodeLines({ node: firstOf('market'), level: 0 })[0]).toBe('pays gold');
  });

  it('shows a Dungeon’s Threat rating and its Omen, and nothing of what is inside', () => {
    const lines = nodeLines({ node: firstOf('dungeon'), level: 3 }).join(' ');

    expect(lines).toContain('enemy level 3');
    expect(lines).toContain('omen');
    // §11: "Composition is unknown until entered." The card cannot name an
    // archetype because the view is never given one — it is drawn on entry,
    // off a different stream.
    expect(lines).not.toContain('Rat');
    expect(lines).not.toContain('Warden');
  });

  it('lays four cards out symmetrically about the centre', () => {
    const seats = [0, 1, 2, 3].map((index) => nodeSeat(index, 4));
    const first = seats[0]?.x ?? 0;
    const last = seats[3]?.x ?? 0;

    expect((first + last) / 2).toBe(LAYOUT.width / 2);
  });
});

describe('scene data is narrowed, never assumed (CLAUDE.md §3.3)', () => {
  it('accepts a well-formed payload', () => {
    const run = startRun(3);
    expect(isRunSceneData({ view: viewOf(run), run, dispatch: (): void => undefined })).toBe(true);
  });

  it('refuses what Phaser might otherwise hand through', () => {
    const run = startRun(3);
    expect(isRunSceneData(undefined)).toBe(false);
    expect(isRunSceneData({})).toBe(false);
    expect(isRunSceneData({ view: viewOf(run), run })).toBe(false);
    expect(isRunSceneData({ view: { kind: 'map' }, run, dispatch: 'not a function' })).toBe(false);
  });
});
