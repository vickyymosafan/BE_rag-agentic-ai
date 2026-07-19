import type { CloudflareBindings } from '../types';

const PROVIDER_LIMITS: Record<string, { daily: number; monthly?: number }> = {
  gemini: { daily: 1500 },
  groq: { daily: 14400 },
  cohere: { daily: 33, monthly: 1000 },
};

export async function trackRPDCall(
  provider: string,
  env: CloudflareBindings
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const key = `stats:rpd:${provider}:${today}`;
  const count = await env.KV_CACHE.get<number>(key, 'json');
  await env.KV_CACHE.put(key, JSON.stringify((count || 0) + 1), { expirationTtl: 86400 * 2 });

  if (provider === 'cohere') {
    const monthKey = `stats:rpd:cohere:${today.slice(0, 7)}`;
    const monthCount = await env.KV_CACHE.get<number>(monthKey, 'json');
    await env.KV_CACHE.put(monthKey, JSON.stringify((monthCount || 0) + 1), { expirationTtl: 86400 * 32 });
  }
}

export async function checkRPDLimit(
  provider: string,
  env: CloudflareBindings
): Promise<{ allowed: boolean; remaining: number; limit: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const limit = PROVIDER_LIMITS[provider];
  if (!limit) return { allowed: true, remaining: Infinity, limit: Infinity };

  const key = `stats:rpd:${provider}:${today}`;
  const count = await env.KV_CACHE.get<number>(key, 'json') || 0;
  const remaining = limit.daily - count;

  if (remaining <= 0) {
    console.warn(`RPD limit reached for ${provider}: ${count}/${limit.daily}`);
    return { allowed: false, remaining: 0, limit: limit.daily };
  }

  if (remaining < limit.daily * 0.1) {
    console.warn(`RPD warning for ${provider}: ${count}/${limit.daily} (${remaining} remaining)`);
  }

  return { allowed: true, remaining, limit: limit.daily };
}

export async function getRPDStats(
  env: CloudflareBindings,
  days: number = 7
): Promise<Record<string, Array<{ date: string; count: number }>>> {
  const providers = ['gemini', 'groq', 'cohere', 'openrouter'];
  const stats: Record<string, Array<{ date: string; count: number }>> = {};

  for (const provider of providers) {
    const data: Array<{ date: string; count: number }> = [];
    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const count = await env.KV_CACHE.get<number>(`stats:rpd:${provider}:${dateStr}`, 'json');
      data.push({ date: dateStr, count: count || 0 });
    }
    stats[provider] = data;
  }

  return stats;
}
