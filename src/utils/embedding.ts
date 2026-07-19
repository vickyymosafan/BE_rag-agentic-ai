import type { CloudflareBindings } from '../types';

const GEMINI_EMBED_URL = 'https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent';
const WORKERS_AI_URL = 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/@cf/baai/bge-base-en-v1.5';

export async function embedQuery(
  query: string,
  env: CloudflareBindings
): Promise<number[]> {
  try {
    return await embedGemini(query, env);
  } catch (err) {
    console.warn('Gemini embedding failed, falling back to Workers AI:', err);
    return embedWorkersAI(query, env);
  }
}

async function embedGemini(query: string, env: CloudflareBindings): Promise<number[]> {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  const res = await fetch(`${GEMINI_EMBED_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'models/text-embedding-004',
      content: { parts: [{ text: query }] },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('Gemini Embedding error:', err);
    throw new Error(`Embedding failed: ${res.status}`);
  }

  const data = await res.json() as { embedding: { values: number[] } };
  return data.embedding.values;
}

async function embedWorkersAI(query: string, env: CloudflareBindings): Promise<number[]> {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  if (!accountId) throw new Error('CLOUDFLARE_ACCOUNT_ID not configured');

  const res = await fetch(WORKERS_AI_URL.replace('{account_id}', accountId), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.GEMINI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: query }),
  });

  if (!res.ok) throw new Error(`Workers AI embedding failed: ${res.status}`);
  const data = await res.json() as { result?: { data?: number[] } };
  return data.result?.data || [];
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}
