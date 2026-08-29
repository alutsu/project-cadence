import type { CardCatalogue, CardDefinition } from '../sim/card.ts';
import { actorId, cardId, type CardId } from '../sim/ids.ts';
import type { CombatSetup } from '../sim/combat.ts';
import { tick } from '../sim/tick.ts';

/**
 * The S1 test scenario: the player at Speed 100 against the Poison Rat at 130
 * (GDD §4.1's own worked example, and §12.2's fast-chip archetype). Cards use
 * the Weight/Recovery classes from §4.1; damage is flat (M0 plan D9).
 */
export const PLAYER = actorId('player');
export const RAT = actorId('rat');

export const LIGHT = cardId('strike');
export const STANDARD = cardId('cleave');
export const HEAVY = cardId('crush');

interface CardSpec {
  readonly id: CardId;
  readonly name: string;
  readonly weight: number;
  readonly recovery: number;
  readonly damage: number;
}

function card(spec: CardSpec): CardDefinition {
  return {
    id: spec.id,
    name: spec.name,
    weight: tick(spec.weight),
    recovery: tick(spec.recovery),
    damage: spec.damage,
  };
}

export const CATALOGUE: CardCatalogue = {
  [LIGHT]: card({ id: LIGHT, name: 'Strike', weight: 4, recovery: 8, damage: 9 }),
  [STANDARD]: card({ id: STANDARD, name: 'Cleave', weight: 6, recovery: 14, damage: 14 }),
  [HEAVY]: card({ id: HEAVY, name: 'Crush', weight: 10, recovery: 26, damage: 24 }),
};

export function scenario(): CombatSetup {
  return {
    actors: [
      { id: PLAYER, name: 'Adventurer', side: 'player', baseSpeed: 100, maxHp: 70, intent: null },
      {
        id: RAT,
        name: 'Poison Rat',
        side: 'enemy',
        baseSpeed: 130,
        maxHp: 30,
        intent: { name: 'Gnaw', weight: tick(4), damage: 3 },
      },
    ],
    catalogue: CATALOGUE,
    hand: [LIGHT, STANDARD, HEAVY],
  };
}
