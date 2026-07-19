import type { CloudflareBindings } from '../types';

interface FeedbackEntry {
  query: string;
  userId: string;
  rating: 'up' | 'down';
  timestamp: number;
}

export async function recordFeedback(
  query: string,
  userId: string,
  rating: 'up' | 'down',
  env: CloudflareBindings
): Promise<void> {
  const { hashQuery } = await import('../utils/hash');
  const queryHash = await hashQuery(query);
  const feedbackId = `feedback:${queryHash}:${userId}:${Date.now()}`;

  const entry: FeedbackEntry = { query, userId, rating, timestamp: Date.now() };
  await env.KV_CACHE.put(feedbackId, JSON.stringify(entry), { expirationTtl: 86400 * 90 });

  const aggKey = `meta:feedback:${queryHash}`;
  const agg = await env.KV_CACHE.get<{ up: number; down: number }>(aggKey, 'json');
  const updated = {
    up: (agg?.up || 0) + (rating === 'up' ? 1 : 0),
    down: (agg?.down || 0) + (rating === 'down' ? 1 : 0),
  };
  await env.KV_CACHE.put(aggKey, JSON.stringify(updated), { expirationTtl: 86400 * 90 });
}

export async function applyFeedbackToCache(
  query: string,
  env: CloudflareBindings
): Promise<void> {
  const { hashQuery } = await import('../utils/hash');
  const queryHash = await hashQuery(query);
  const aggKey = `meta:feedback:${queryHash}`;
  const agg = await env.KV_CACHE.get<{ up: number; down: number }>(aggKey, 'json');
  if (!agg) return;

  const popKey = `meta:popular:${queryHash}`;
  const meta = await env.KV_CACHE.get<{ query: string; hitCount: number }>(popKey, 'json');
  if (!meta) return;

  const netScore = agg.up - agg.down;
  if (netScore < -2) {
    const exactKey = `search:${queryHash}`;
    await env.KV_CACHE.delete(exactKey);
    const semanticKey = `semantic:${queryHash}`;
    await env.KV_CACHE.delete(semanticKey);
    await env.KV_CACHE.delete(popKey);
    await env.KV_CACHE.delete(aggKey);
  } else if (netScore > 2) {
    meta.hitCount = Math.max(meta.hitCount, 5);
    await env.KV_CACHE.put(popKey, JSON.stringify(meta), { expirationTtl: 86400 * 30 });
  }
}

export async function getPopularFAQ(
  env: CloudflareBindings,
  limit: number = 10
): Promise<Array<{ query: string; hitCount: number; netFeedback: number }>> {
  const keys = await env.KV_CACHE.list({ prefix: 'meta:popular:' });
  const entries: Array<{ query: string; hitCount: number; netFeedback: number }> = [];

  for (const key of keys.keys) {
    const meta = await env.KV_CACHE.get<{ query: string; hitCount: number }>(key.name, 'json');
    if (!meta) continue;

    const queryHash = key.name.replace('meta:popular:', '');
    const aggKey = `meta:feedback:${queryHash}`;
    const agg = await env.KV_CACHE.get<{ up: number; down: number }>(aggKey, 'json');
    const netFeedback = agg ? agg.up - agg.down : 0;

    entries.push({ query: meta.query, hitCount: meta.hitCount, netFeedback });
  }

  return entries.sort((a, b) => b.hitCount - a.hitCount).slice(0, limit);
}
