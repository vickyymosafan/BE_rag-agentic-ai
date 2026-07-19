import type { CloudflareBindings } from '../types';

const GEMINI_EMBED_URL = 'https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent';

export async function embedQuery(
  query: string,
  env: CloudflareBindings
): Promise<number[]> {
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
