import type { CardDefinition } from '../sim/card.ts';
import { isFrame, isGemTier, type Gem, type GemCatalogue, type GemEffect } from '../sim/gem.ts';
import { isRegisteredEffect, modifierOf } from '../sim/gemEffects.ts';
import { cardId, gemId } from '../sim/ids.ts';
import { WEIGHT_CLASSES } from '../sim/weightClass.ts';
import { isTag } from '../sim/tag.ts';
import '../sim/standardEffects.ts';
import type { ParseResult } from './cards.ts';

/**
 * Gem validation (CLAUDE.md §3.3). A gem arrives either from `frames.json` via
 * the forge or from a save, and neither is a promise that it matches the
 * interface — an invalid gem must fail at load rather than halfway through an
 * encounter.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readEffect(value: unknown, gem: string, kind: string): GemEffect | string {
  if (!isRecord(value)) return `gem "${gem}" has a ${kind} that is not an object`;

  const { type, value: rolled, tag } = value;
  if (typeof type !== 'string' || type.length === 0)
    return `gem "${gem}" has a ${kind} with no type`;
  if (!isRegisteredEffect(type)) return `gem "${gem}" names unregistered effect "${type}"`;
  if (typeof rolled !== 'number' || !Number.isFinite(rolled)) {
    return `gem "${gem}" ${kind} "${type}" has a non-numeric value`;
  }

  // Most atoms take a magnitude; KINDLE's takes a tag. Absent means absent
  // rather than "not filled in yet" (CLAUDE.md §3.2), so it reads as null.
  const named: unknown = tag ?? null;
  if (named !== null && !isTag(named)) {
    return `gem "${gem}" ${kind} "${type}" names an unknown tag: ${JSON.stringify(tag)}`;
  }

  return { type, value: rolled, tag: named };
}

function readEffects(value: unknown, gem: string, kind: string): readonly GemEffect[] | string {
  if (!Array.isArray(value)) return `gem "${gem}" has no ${kind} array`;

  const read = value.map((entry) => readEffect(entry, gem, kind));
  const failure = read.find((entry): entry is string => typeof entry === 'string');
  if (failure !== undefined) return failure;

  return read.filter((entry): entry is GemEffect => typeof entry !== 'string');
}

function readGem(value: unknown, position: number): Gem | string {
  if (!isRecord(value)) return `gem ${String(position)} is not an object`;

  const { id, frame, tier, words, weightDelta, effects, affixes } = value;
  if (typeof id !== 'string' || id.length === 0) return `gem ${String(position)} has no id`;
  if (!isFrame(frame)) return `gem "${id}" has an unknown frame: ${JSON.stringify(frame)}`;
  if (!isGemTier(tier)) return `gem "${id}" has an invalid tier: ${JSON.stringify(tier)}`;
  if (typeof weightDelta !== 'number' || !Number.isInteger(weightDelta)) {
    return `gem "${id}" has a non-integer weightDelta`;
  }

  const said: unknown = words ?? [];
  if (!Array.isArray(said) || !said.every((word) => typeof word === 'string')) {
    return `gem "${id}" has invalid words`;
  }

  const read = readEffects(effects, id, 'effect');
  if (typeof read === 'string') return read;
  const rolled = readEffects(affixes ?? [], id, 'affix');
  if (typeof rolled === 'string') return rolled;

  return {
    id: gemId(id),
    frame,
    tier,
    words: said,
    weightDelta,
    effects: read,
    affixes: rolled,
  };
}

/**
 * A card that exists only to prove the gems resolve. Running the real handlers
 * at load is what catches an atom whose *parameter* is wrong rather than its
 * type — a KINDLE that names no tag type-checks perfectly and throws the first
 * time it is swung, which is exactly the failure §3.3 exists to move to boot.
 */
const PROBE: CardDefinition = {
  id: cardId('__probe'),
  name: 'probe',
  weightClass: 'light',
  ...WEIGHT_CLASSES.light,
  damage: 1,
  targeting: 'single',
  tag: 'Physical',
  applies: null,
};

function reasonOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

export function parseGemCatalogue(input: unknown): ParseResult<GemCatalogue> {
  if (!isRecord(input) || !Array.isArray(input.gems)) {
    return { ok: false, errors: ['gem data has no "gems" array'] };
  }

  const read = input.gems.map((entry, position) => readGem(entry, position));
  const errors = read.filter((entry): entry is string => typeof entry === 'string');
  if (errors.length > 0) return { ok: false, errors };

  const gems = read.filter((entry): entry is Gem => typeof entry !== 'string');
  const duplicates = gems.map((gem) => gem.id).filter((id, at, all) => all.indexOf(id) !== at);
  if (duplicates.length > 0)
    return { ok: false, errors: [`duplicate gem ids: ${duplicates.join(', ')}`] };

  const resolved: string[] = [];
  for (const gem of gems) {
    try {
      modifierOf([...gem.effects, ...gem.affixes], PROBE);
    } catch (failure) {
      resolved.push(`gem "${gem.id}" does not resolve: ${reasonOf(failure)}`);
    }
  }
  if (resolved.length > 0) return { ok: false, errors: resolved };

  const catalogue: Record<string, Gem> = {};
  for (const gem of gems) catalogue[gem.id] = gem;
  return { ok: true, value: catalogue };
}
