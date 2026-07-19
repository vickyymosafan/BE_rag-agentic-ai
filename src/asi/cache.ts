import type { CloudflareBindings, CacheEntry } from '../types';
import { embedQuery, cosineSimilarity } from '../utils/embedding';
import { hashQuery } from '../utils/hash';

const EXACT_TTL = 86400;
const SEMANTIC_TTL = 604800;
const MAX_TTL = 604800;
const SEMANTIC_THRESHOLD = 0.92;

export async function getFromCache(
  query: string,
  env: CloudflareBindings
): Promise<CacheEntry | null> {
  const queryHash = await hashQuery(query);

  const exact = await env.KV_CACHE.get<CacheEntry>(`search:${queryHash}`, 'json');
  if (exact) {
    exact.hitCount++;
    await updatePopAndTTL(exact, env, `search:${queryHash}`);
    await trackCacheHit(env, 'exact');
    return exact;
  }

  const queryEmb = await embedQuery(query, env);
  const cacheKeys = await env.KV_CACHE.list({ prefix: 'semantic:' });

  let bestMatch: CacheEntry | null = null;
  let bestScore = 0;

  for (const key of cacheKeys.keys) {
    const entry = await env.KV_CACHE.get<CacheEntry>(key.name, 'json');
    if (!entry) continue;

    const similarity = cosineSimilarity(queryEmb, entry.queryEmbedding);
    if (similarity > SEMANTIC_THRESHOLD && similarity > bestScore) {
      bestScore = similarity;
      bestMatch = entry;
    }
  }

  if (bestMatch) {
    bestMatch.hitCount++;
    await updatePopAndTTL(bestMatch, env, `semantic:${queryHash}`);
    await trackCacheHit(env, 'semantic');
  } else {
    await trackCacheHit(env, 'miss');
  }

  return bestMatch;
}

export async function setCache(
  query: string,
  entry: CacheEntry,
  env: CloudflareBindings
): Promise<void> {
  const queryHash = await hashQuery(query);

  await env.KV_CACHE.put(`search:${queryHash}`, JSON.stringify(entry), {
    expirationTtl: EXACT_TTL,
  });

  await env.KV_CACHE.put(`semantic:${queryHash}`, JSON.stringify(entry), {
    expirationTtl: SEMANTIC_TTL,
  });

  await env.KV_CACHE.put(
    `meta:popular:${queryHash}`,
    JSON.stringify({ query, hitCount: 0, firstCached: Date.now() }),
    { expirationTtl: SEMANTIC_TTL }
  );
}

export async function getTopCachedQueries(
  env: CloudflareBindings,
  limit: number = 10
): Promise<Array<{ query: string; hitCount: number }>> {
  const keys = await env.KV_CACHE.list({ prefix: 'meta:popular:' });
  const entries: Array<{ query: string; hitCount: number }> = [];

  for (const key of keys.keys) {
    const meta = await env.KV_CACHE.get<{ query: string; hitCount: number }>(key.name, 'json');
    if (meta) entries.push(meta);
  }

  return entries.sort((a, b) => b.hitCount - a.hitCount).slice(0, limit);
}

async function updatePopAndTTL(
  entry: CacheEntry,
  env: CloudflareBindings,
  key: string
): Promise<void> {
  const ttl = Math.min(EXACT_TTL * entry.hitCount, MAX_TTL);
  await env.KV_CACHE.put(key, JSON.stringify(entry), { expirationTtl: ttl });

  const popKey = key.replace(/^(search|semantic):/, 'meta:popular:');
  const meta = await env.KV_CACHE.get<{ query: string; hitCount: number; firstCached: number }>(popKey, 'json');
  if (meta) {
    meta.hitCount = entry.hitCount;
    await env.KV_CACHE.put(popKey, JSON.stringify(meta), { expirationTtl: MAX_TTL });
  }
}

async function trackCacheHit(
  env: CloudflareBindings,
  type: 'exact' | 'semantic' | 'miss'
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const key = `stats:cache:${today}:${type}`;
  const count = await env.KV_CACHE.get<number>(key, 'json');
  await env.KV_CACHE.put(key, JSON.stringify((count || 0) + 1), { expirationTtl: 86400 * 30 });
}
