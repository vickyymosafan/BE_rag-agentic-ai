import type { CloudflareBindings, RetrievalResult } from '../types';
import { cosineSimilarity, embedQuery } from '../utils/embedding';

export async function rerankChunks(
  results: RetrievalResult[],
  query: string,
  env: CloudflareBindings
): Promise<RetrievalResult[]> {
  if (results.length <= 3) return results;

  const queryEmb = await embedQuery(query, env);

  const reranked = await Promise.all(
    results.map(async (r) => {
      const chunkEmb = await embedQuery(r.content.slice(0, 500), env);
      const cosSim = cosineSimilarity(queryEmb, chunkEmb);
      const rerankScore = (cosSim * 0.6) + (r.score * 0.4);
      return { ...r, score: rerankScore, source: 'rerank' as const };
    })
  );

  return reranked.sort((a, b) => b.score - a.score);
}
