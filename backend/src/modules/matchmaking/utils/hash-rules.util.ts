import * as crypto from 'crypto';

// Produces a stable hash for a rules object so tickets with identical
// rules get bucketed into the same matchmaking queue. Key order in the
// input object shouldn't matter, so we sort keys before hashing.
export function hashRules(rules: Record<string, unknown>): string {
  const sorted = sortObjectKeys(rules ?? {});
  const json = JSON.stringify(sorted);
  return crypto.createHash('sha256').update(json).digest('hex').slice(0, 16);
}

function sortObjectKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys);
  }
  if (obj && typeof obj === 'object') {
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortObjectKeys((obj as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return obj;
}
