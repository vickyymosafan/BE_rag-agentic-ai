import type { CloudflareBindings, QueryType, RetrievalResult } from '../types';
import { embedQuery } from '../utils/embedding';
import { vectorSearch, bm25Search } from '../db/queries';

const QUERY_STRATEGIES: Record<QueryType, { vector: number; bm25: number; topK: number }> = {
  text: { vector: 0.7, bm25: 0.3, topK: 5 },
  table: { vector: 0.4, bm25: 0.6, topK: 10 },
  image: { vector: 0.8, bm25: 0.2, topK: 3 },
  complex: { vector: 0.6, bm25: 0.4, topK: 7 },
  hybrid: { vector: 0.5, bm25: 0.5, topK: 5 },
};

const DOC_TYPE_RANGES: Record<string, { topKBoost: number }> = {
  pdf: { topKBoost: 1.5 },
  docx: { topKBoost: 1.2 },
};

export async function adaptiveRetrieve(
  query: string,
  type: QueryType,
  env: CloudflareBindings,
  docFilter?: string[],
  docTypes?: string[]
): Promise<RetrievalResult[]> {
  const strategy = QUERY_STRATEGIES[type];

  let adjustedTopK = strategy.topK;
  if (docTypes) {
    for (const dt of docTypes) {
      const range = DOC_TYPE_RANGES[dt];
      if (range) adjustedTopK = Math.round(adjustedTopK * range.topKBoost);
    }
  }

  const embedding = await embedQuery(query, env);
  const [vectorResults, bm25Results] = await Promise.all([
    vectorSearch(embedding, adjustedTopK, env, docFilter),
    bm25Search(query, adjustedTopK, env),
  ]);

  return fusionWeighted(vectorResults, bm25Results, strategy);
}

function fusionWeighted(
  vector: RetrievalResult[],
  bm25: RetrievalResult[],
  strategy: { vector: number; bm25: number; topK: number }
): RetrievalResult[] {
  const seen = new Set<string>();
  const fused: RetrievalResult[] = [];

  for (const v of vector) {
    fused.push({ ...v, score: v.score * strategy.vector, source: 'fusion' as const });
    seen.add(v.chunkId);
  }

  for (const b of bm25) {
    if (!seen.has(b.chunkId)) {
      fused.push({ ...b, score: b.score * strategy.bm25, source: 'fusion' as const });
    }
  }

  return fused
    .sort((a, b) => b.score - a.score)
    .slice(0, strategy.topK * 2);
}
