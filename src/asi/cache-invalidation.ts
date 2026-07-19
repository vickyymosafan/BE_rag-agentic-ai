import type { CloudflareBindings } from '../types';

export async function invalidateDocCache(
  docId: string,
  env: CloudflareBindings
): Promise<number> {
  let deletedCount = 0;

  const exactKeys = await env.KV_CACHE.list({ prefix: 'search:' });
  const semanticKeys = await env.KV_CACHE.list({ prefix: 'semantic:' });

  const allKeys = [...exactKeys.keys, ...semanticKeys.keys];
  for (const key of allKeys) {
    const entry = await env.KV_CACHE.get(key.name, 'json') as { sources?: Array<{ docId: string }> } | null;
    if (entry?.sources?.some(s => s.docId === docId)) {
      await env.KV_CACHE.delete(key.name);
      deletedCount++;
    }
  }

  const metaKeys = await env.KV_CACHE.list({ prefix: 'meta:popular:' });
  for (const key of metaKeys.keys) {
    const queryHash = key.name.replace('meta:popular:', '');
    const feedbackKey = `meta:feedback:${queryHash}`;
    await env.KV_CACHE.delete(feedbackKey);
    await env.KV_CACHE.delete(key.name);
    deletedCount++;
  }

  console.warn(`Cache invalidation: ${deletedCount} entries removed for doc ${docId}`);
  return deletedCount;
}
