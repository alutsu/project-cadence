import type { ActorSeed } from '../sim/combat.ts';
import { actorId } from '../sim/ids.ts';
import { tick } from '../sim/tick.ts';
import { NO_RESISTANCE, resistTo } from '../sim/weave.ts';
import { scaleEnemy } from './encounters.ts';
import type { EnemyArchetype } from './archetypes.ts';

/**
 * Bosses (GDD §12.3).
 *
 * > Each boss must attack a different assumption.
 * > 1. **Depth 1 — The Clockeater.** Teaches the queue. Long wind-up, high
 * >    Poise; the fight is a Stagger puzzle. Beatable by any build.
 *
 * §18 budgets **one** boss for M2 and §12.3 names four, so this is one
 * authored boss in four slots: Depths 2–4 field the Clockeater re-levelled
 * until M3 writes the other three. That is a stand-in with a real cost — a run
 * currently meets the same boss four times — and it is preferable to a Depth
 * ending on nothing, which is what a boss node did before this file existed: it
 * generated like a Dungeon, and a playtest met a lone Emberhide as a Depth-1
 * boss.
 */

export interface BossDefinition {
  readonly id: string;
  readonly archetype: EnemyArchetype;
  /** Which Depth §12.3 assigns it. */
  readonly depth: number;
  /** The assumption it attacks (§12.3). Not flavour — it is the design brief. */
  readonly teaches: string;
}

/**
 * GDD §12.3's Depth-1 boss: a long wind-up and high Poise, so the fight is the
 * Stagger puzzle rather than a damage race.
 *
 * The numbers answer a specific failure the playtests found twice: a Poise
 * threshold above anything the deck can hit does not make a hard fight, it
 * makes an *unavailable* one, because the whole answer the fight poses cannot
 * be attempted. Poise 14 at Depth 1 sits under a Standard card and over a
 * Light one, so staggering it is a decision about which card rather than a
 * question of whether you happen to own the right one.
 */
const CLOCKEATER_ARCHETYPE: EnemyArchetype = {
  id: 'clockeater',
  name: 'The Clockeater',
  // Slower than anything else in the roster: the wind-up has to be readable
  // eight slots out, which is what makes §4.2's forecast the fight (§12.3).
  baseSpeed: 60,
  baseHp: 96,
  basePoise: 14,
  cost: 6,
  minLevel: 0,
  // §12.3: no boss may have a hard immunity. A light resistance is allowed and
  // is what makes the Weave worth reading here rather than ignorable.
  resistances: resistTo({ Physical: 0.2 }),
  intents: [
    // The telegraph the fight is built on. Weight 20 is four Light cards' worth
    // of the player's time, all of it visible in the strip before it lands.
    { name: 'Devour the Hour', weight: tick(20), damage: 22, applies: null },
    {
      name: 'Tick',
      weight: tick(7),
      damage: 4,
      applies: { kind: 'slow', magnitude: 15, duration: tick(14) },
    },
    { name: 'Tock', weight: tick(7), damage: 6, applies: null },
  ],
};

export const CLOCKEATER: BossDefinition = {
  id: 'clockeater',
  archetype: CLOCKEATER_ARCHETYPE,
  depth: 1,
  teaches: 'the queue — a wind-up you can read, and must answer',
};

export const BOSSES: readonly BossDefinition[] = [CLOCKEATER];

/**
 * §12.3's two prohibitions, asserted rather than commented.
 *
 * "No boss may have a hard immunity. No boss may apply unavoidable Max HP
 * loss." The first is checkable here; the second is checkable only in the sense
 * that nothing in the sim applies Max HP loss at all — so it is stated as an
 * invariant the day something does, rather than the day M3 authors a boss that
 * breaks it silently.
 */
function assertBossRules(bosses: readonly BossDefinition[]): void {
  const immunities = bosses.flatMap((boss) =>
    Object.entries(boss.archetype.resistances)
      .filter(([, resistance]) => resistance.kind === 'immune')
      .map(([tag]) => `${boss.id} is immune to ${tag}`),
  );
  if (immunities.length > 0) {
    throw new Error(`§12.3 forbids a boss with a hard immunity: ${immunities.join('; ')}`);
  }

  const unstaggerable = bosses.filter((boss) => boss.archetype.basePoise <= 0);
  if (unstaggerable.length > 0) {
    throw new Error(
      `§12.3 asks a boss to be beatable by any build, so it must be staggerable: ` +
        unstaggerable.map((boss) => boss.id).join(', '),
    );
  }
}

assertBossRules(BOSSES);

/**
 * The boss that ends this Depth, at the level the route has earned.
 *
 * [M2 STAND-IN] Depths 2–4 field the Clockeater until §12.3's other three are
 * authored. Deleted by adding entries to `BOSSES`, not by changing code here.
 */
export function bossFor(depth: number, level: number): readonly ActorSeed[] {
  const authored = BOSSES.find((boss) => boss.depth === depth) ?? CLOCKEATER;
  const seed = scaleEnemy(authored.archetype, level, `boss_d${String(depth)}`);

  return [
    {
      ...seed,
      id: actorId(`boss_d${String(depth)}`),
      resistances: seed.resistances ?? NO_RESISTANCE,
    },
  ];
}
