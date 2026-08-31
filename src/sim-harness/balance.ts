import { m0Catalogue } from '../data/cards.ts';
import { ENCOUNTERS } from '../data/encounters.ts';
import type { CardDefinition } from '../sim/card.ts';
import type { ActorSeed } from '../sim/combat.ts';
import type { CombatEvent } from '../sim/events.ts';
import type { ActorId, CardId } from '../sim/ids.ts';
import { damagePerTarget } from '../sim/targeting.ts';
import { POLICIES, type Policy } from './policy.ts';
import { playEncounter, type EncounterOutcome, type Offer } from './sweep.ts';

/**
 * The balance report (GDD §19, CLAUDE.md §7.3).
 *
 * Every figure is counted off the combat event log rather than recomputed, so
 * the report cannot disagree with the game it is measuring (CLAUDE.md §2.2). It
 * answers what the sweep does not: which cards are never worth playing (M0 gate
 * question 6), and which enemies actually carry their encounter.
 *
 * The policies are deliberately poor players — none Guards or Staggers on
 * purpose — so read every rate as a floor a competent human beats, and read the
 * *gaps* between cards and between enemies rather than any single number.
 */

interface CardTally {
  held: number;
  played: number;
  damage: number;
  staggers: number;
  kills: number;
  ticksSpent: number;
}

interface EnemyTally {
  appearances: number;
  damageToPlayer: number;
  staggered: number;
  killingBlows: number;
  ticksAlive: number;
  deaths: number;
}

/** What last harmed the player, so a death can be attributed to a cause. */
type Harm = { readonly kind: 'enemy'; readonly name: string } | { readonly kind: 'status' };

class Ledger {
  readonly cards = new Map<CardId, CardTally>();
  readonly enemies = new Map<string, EnemyTally>();
  /** Player deaths by cause, so Poison is not filed under whoever last bit. */
  readonly deathsBy = new Map<string, number>();

  card(id: CardId): CardTally {
    const found = this.cards.get(id) ?? {
      held: 0,
      played: 0,
      damage: 0,
      staggers: 0,
      kills: 0,
      ticksSpent: 0,
    };
    this.cards.set(id, found);
    return found;
  }

  enemy(name: string): EnemyTally {
    const found = this.enemies.get(name) ?? {
      appearances: 0,
      damageToPlayer: 0,
      staggered: 0,
      killingBlows: 0,
      ticksAlive: 0,
      deaths: 0,
    };
    this.enemies.set(name, found);
    return found;
  }

  death(cause: string): void {
    this.deathsBy.set(cause, (this.deathsBy.get(cause) ?? 0) + 1);
  }
}

/** Two Poison Rats are one archetype; the ordinal names a seat, not a statline. */
function archetypeOf(name: string): string {
  return name.replace(/ \d+$/, '');
}

interface Roster {
  readonly player: ActorId;
  readonly enemyNames: ReadonlyMap<ActorId, string>;
}

function rosterOf(actors: readonly ActorSeed[]): Roster {
  const enemyNames = new Map<ActorId, string>();
  let player: ActorId | null = null;
  for (const actor of actors) {
    if (actor.side === 'player') player = actor.id;
    else enemyNames.set(actor.id, archetypeOf(actor.name));
  }
  if (player === null) throw new Error('an encounter with no player cannot be measured');
  return { player, enemyNames };
}

/** Running attribution state, carried across one encounter's log. */
interface Credit {
  /** The card whose consequences are still landing. */
  card: CardId | null;
  harm: Harm | null;
}

interface Attribution {
  readonly ledger: Ledger;
  readonly roster: Roster;
  readonly credit: Credit;
}

/**
 * A card is credited with every blow the player lands until the next card is
 * played, which is how an AoE's three hits reach the card that swung them
 * (GDD §4.8). A wind-up Ultimate lands after later cards and would be misfiled;
 * that rule is off by default (GDD §22 Q1) and the report says which is in use.
 */
function creditEvent(into: Attribution, event: CombatEvent): void {
  const { ledger, roster, credit } = into;
  if (event.kind === 'card_played') {
    ledger.card(event.card).ticksSpent += event.weight;
    credit.card = event.card;
    return;
  }
  if (event.kind === 'guarded') {
    credit.card = null;
    return;
  }
  if (event.kind === 'damage_dealt') creditDamage(into, event);
  if (event.kind === 'status_proc' && event.actor === roster.player)
    credit.harm = { kind: 'status' };
  if (event.kind === 'staggered') creditStagger(into, event.actor);
  if (event.kind === 'actor_died') creditDeath(into, event.actor);
}

function creditDamage(
  into: Attribution,
  event: Extract<CombatEvent, { kind: 'damage_dealt' }>,
): void {
  const { ledger, roster, credit } = into;
  if (event.source === roster.player && credit.card !== null) {
    ledger.card(credit.card).damage += event.amount;
  }
  const attacker = roster.enemyNames.get(event.source);
  if (attacker === undefined || event.target !== roster.player) return;
  ledger.enemy(attacker).damageToPlayer += event.amount;
  credit.harm = { kind: 'enemy', name: attacker };
}

function creditStagger(into: Attribution, actor: ActorId): void {
  const { ledger, roster, credit } = into;
  const shaken = roster.enemyNames.get(actor);
  if (shaken !== undefined) ledger.enemy(shaken).staggered += 1;
  if (credit.card !== null) ledger.card(credit.card).staggers += 1;
}

function creditDeath(into: Attribution, actor: ActorId): void {
  const { ledger, roster, credit } = into;
  if (actor !== roster.player) {
    if (credit.card !== null) ledger.card(credit.card).kills += 1;
    return;
  }
  const harm = credit.harm;
  if (harm === null) return;
  ledger.death(harm.kind === 'status' ? 'a status' : harm.name);
  if (harm.kind === 'enemy') ledger.enemy(harm.name).killingBlows += 1;
}

function tallyOffer(ledger: Ledger, offer: Offer): void {
  for (const held of new Set(offer.hand)) ledger.card(held).held += 1;
  if (offer.chosen !== null) ledger.card(offer.chosen).played += 1;
}

function tally(ledger: Ledger, roster: Roster, outcome: EncounterOutcome): void {
  // Per actor, not per archetype: Scurry fields two Poison Rats, and counting
  // that as one appearance divided two rats' damage and two deaths by one.
  for (const name of roster.enemyNames.values()) ledger.enemy(name).appearances += 1;

  for (const offer of outcome.offers) tallyOffer(ledger, offer);

  const into: Attribution = { ledger, roster, credit: { card: null, harm: null } };
  for (const event of outcome.events) creditEvent(into, event);

  for (const [id, name] of roster.enemyNames) {
    const died = outcome.events.find((event) => event.kind === 'actor_died' && event.actor === id);
    const enemy = ledger.enemy(name);
    enemy.ticksAlive += died?.at ?? outcome.ticks;
    if (died !== undefined) enemy.deaths += 1;
  }
}

/** Every encounter, every policy, every seed. */
export function gather(seeds: number): Ledger {
  const ledger = new Ledger();
  for (const encounter of ENCOUNTERS) {
    const roster = rosterOf(encounter.actors);
    for (const { play } of POLICIES) tallySeeds({ ledger, roster, encounter, play, seeds });
  }
  return ledger;
}

interface SeedRun {
  readonly ledger: Ledger;
  readonly roster: Roster;
  readonly encounter: (typeof ENCOUNTERS)[number];
  readonly play: Policy;
  readonly seeds: number;
}

function tallySeeds(run: SeedRun): void {
  for (let seed = 1; seed <= run.seeds; seed += 1) {
    const outcome = playEncounter({ actors: run.encounter.actors, policy: run.play, seed });
    tally(run.ledger, run.roster, outcome);
  }
}

const PERCENT = 100;

function rate(part: number, whole: number): string {
  return whole === 0 ? '  —' : `${((part / whole) * PERCENT).toFixed(0).padStart(3)}%`;
}

function per(total: number, whole: number, places = 1): string {
  return whole === 0 ? '—' : (total / whole).toFixed(places);
}

const SKILL_COLUMNS = [11, 10, 8, 5, 8, 8, 10, 11, 7] as const;
const SKILL_HEADS = [
  'card',
  'class',
  'reach',
  'dmg',
  'held',
  'picked',
  'dmg/tick',
  'stag/play',
  'kills',
] as const;

/** Left-aligns the first cell and right-aligns the figures, as a table reads. */
function row(cells: readonly string[], widths: readonly number[]): string {
  const laid = cells.map((cell, at) => {
    const width = widths[at] ?? cell.length;
    return at === 0 ? cell.padEnd(width) : cell.padStart(width);
  });
  return `  ${laid.join('')}`;
}

function skillTable(ledger: Ledger): readonly string[] {
  const rows = Object.values(m0Catalogue())
    .map((card) => skillRow(card, ledger.card(card.id)))
    .sort((left, right) => right.perTick - left.perTick)
    .map((entry) => row(entry.cells, SKILL_COLUMNS));
  return [row([...SKILL_HEADS], SKILL_COLUMNS), ...rows];
}

interface SkillRow {
  readonly cells: readonly string[];
  readonly perTick: number;
}

function skillRow(card: CardDefinition, tallied: CardTally): SkillRow {
  const perTick = tallied.ticksSpent === 0 ? 0 : tallied.damage / tallied.ticksSpent;
  return {
    perTick,
    cells: [
      card.name,
      card.weightClass,
      card.targeting === 'all' ? 'all' : 'one',
      String(damagePerTarget(card)),
      String(tallied.held),
      rate(tallied.played, tallied.held),
      tallied.ticksSpent === 0 ? '—' : perTick.toFixed(2),
      per(tallied.staggers, tallied.played, 2),
      String(tallied.kills),
    ],
  };
}

/**
 * Cards no better than a sibling. A card sharing another's Weight class and
 * reach inherits its Weight and Recovery from the class table (GDD §4.1), so
 * with nothing else to tell them apart *less damage* leaves nothing to trade
 * back: it is never the right play. Not a close call to be judged by feel —
 * arithmetic, and the cheapest balance finding there is.
 *
 * [M1] The tag is the third axis (docs/M1_PLAN.md D15), and it is what makes
 * two otherwise-identical cards different: a lower-damage card of a
 * better-placed tag is not dominated, it is a different answer to a question
 * the run has not asked yet. Domination therefore requires the same tag as
 * well as the same class and reach — anything else is a comparison the Weave
 * can overturn between one Depth and the next.
 */
export interface Dominated {
  readonly card: string;
  readonly weightClass: string;
  readonly damage: number;
  readonly beatenBy: readonly string[];
}

export function dominatedCards(): readonly Dominated[] {
  const cards = Object.values(m0Catalogue());
  return cards
    .map((card) => ({
      card: card.name,
      weightClass: card.weightClass,
      damage: damagePerTarget(card),
      beatenBy: cards
        .filter(
          (other) =>
            other.weightClass === card.weightClass &&
            other.targeting === card.targeting &&
            other.tag === card.tag &&
            damagePerTarget(other) > damagePerTarget(card),
        )
        .map((other) => other.name),
    }))
    .filter((entry) => entry.beatenBy.length > 0);
}

function dominated(): readonly string[] {
  return dominatedCards().map(
    (entry) =>
      `  ${entry.card} (${entry.weightClass}, ${String(entry.damage)}) is strictly worse than ${entry.beatenBy.join(', ')}`,
  );
}

const ENEMY_COLUMNS = [14, 7, 11, 10, 13, 7, 12] as const;
const ENEMY_HEADS = [
  'enemy',
  'fights',
  'dmg/fight',
  'staggers',
  'ticks alive',
  'died',
  'killed you',
] as const;

function enemyTable(ledger: Ledger): readonly string[] {
  const rows = [...ledger.enemies]
    .sort((left, right) => right[1].damageToPlayer - left[1].damageToPlayer)
    .map(([name, tallied]) =>
      row(
        [
          name,
          String(tallied.appearances),
          per(tallied.damageToPlayer, tallied.appearances),
          per(tallied.staggered, tallied.appearances, 2),
          per(tallied.ticksAlive, tallied.appearances),
          rate(tallied.deaths, tallied.appearances),
          String(tallied.killingBlows),
        ],
        ENEMY_COLUMNS,
      ),
    );
  return [row([...ENEMY_HEADS], ENEMY_COLUMNS), ...rows];
}

function deathCauses(ledger: Ledger): readonly string[] {
  const total = [...ledger.deathsBy.values()].reduce((sum, count) => sum + count, 0);
  if (total === 0) return ['  the policies never died in this pass'];
  return [...ledger.deathsBy]
    .sort((left, right) => right[1] - left[1])
    .map(
      ([cause, count]) =>
        `  ${cause.padEnd(16)}${String(count).padStart(6)}  ${rate(count, total)}`,
    );
}

/** Cards no policy ever chose while holding them — gate question 6, measured. */
function neverPicked(ledger: Ledger): readonly string[] {
  return Object.values(m0Catalogue())
    .filter((card) => {
      const tallied = ledger.card(card.id);
      return tallied.held > 0 && tallied.played === 0;
    })
    .map((card) => `  ${card.name} was held but never played`);
}

export function balanceReport(seeds: number): string {
  const ledger = gather(seeds);
  const runs = ENCOUNTERS.length * POLICIES.length * seeds;

  const findings = [...neverPicked(ledger), ...dominated()];
  return [
    `skills and enemies, ${String(seeds)} seeds × ${String(ENCOUNTERS.length)} encounters × ${String(POLICIES.length)} policies = ${String(runs)} fights`,
    '',
    'skills',
    ...skillTable(ledger),
    '',
    'enemies',
    ...enemyTable(ledger),
    '',
    'what killed the player',
    ...deathCauses(ledger),
    '',
    'flagged',
    ...(findings.length === 0 ? ['  nothing strictly dominated, nothing left unplayed'] : findings),
  ].join('\n');
}
