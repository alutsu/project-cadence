/**
 * Branded entity identifiers (CLAUDE.md §3.2). A bare string is not an id — the
 * brands are what stop a CardId being passed where an ActorId belongs.
 */
export type ActorId = string & { readonly __brand: 'ActorId' };
export type CardId = string & { readonly __brand: 'CardId' };
export type GemId = string & { readonly __brand: 'GemId' };

function requireNonEmpty(value: string, kind: string): string {
  if (value.length === 0) throw new RangeError(`${kind} must not be empty`);
  return value;
}

export function actorId(value: string): ActorId {
  return requireNonEmpty(value, 'ActorId') as ActorId;
}

export function cardId(value: string): CardId {
  return requireNonEmpty(value, 'CardId') as CardId;
}

export function gemId(value: string): GemId {
  return requireNonEmpty(value, 'GemId') as GemId;
}
