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
  const [vectorResults, bm25Results, domainResults] = await Promise.all([
    vectorSearch(embedding, adjustedTopK, env, docFilter),
    bm25Search(query, adjustedTopK, env),
    retrieveDomainSpecific(query, type, env, docFilter),
  ]);

  const fused = fusionWeighted(vectorResults, bm25Results, strategy);
  return [...fused, ...domainResults].sort((a, b) => b.score - a.score);
}

async function retrieveDomainSpecific(
  query: string,
  type: QueryType,
  env: CloudflareBindings,
  docFilter?: string[]
): Promise<RetrievalResult[]> {
  if (type === 'image') return retrieveImages(query, env, docFilter);
  if (type === 'table') return retrieveTables(query, env, docFilter);
  return [];
}

async function retrieveImages(
  query: string,
  env: CloudflareBindings,
  docFilter?: string[]
): Promise<RetrievalResult[]> {
  let sql = 'SELECT id, doc_id, r2_key, mime_type, page_number, caption FROM extracted_images WHERE 1=1';
  const params: unknown[] = [];

  if (docFilter?.length) {
    sql += ' AND doc_id IN (' + docFilter.map(() => '?').join(',') + ')';
    params.push(...docFilter);
  }

  sql += ' ORDER BY page_number LIMIT 5';
  const { results } = await env.DB.prepare(sql).bind(...params).all();

  return (results as Array<Record<string, unknown>>).map((r, i) => ({
    chunkId: `${r.id}`,
    docId: `${r.doc_id}`,
    content: `${r.caption || 'Gambar'} — ${r.mime_type || 'image/png'} (Hal ${r.page_number || 1})`,
    contentType: 'image_ref',
    pageNumber: (r.page_number as number) || 1,
    sectionTitle: r.caption as string || 'Gambar',
    score: 0.7 - (i * 0.05),
    source: 'fusion' as const,
  }));
}

async function retrieveTables(
  query: string,
  env: CloudflareBindings,
  docFilter?: string[]
): Promise<RetrievalResult[]> {
  let sql = 'SELECT id, doc_id, page_number, caption, table_markdown FROM extracted_tables WHERE 1=1';
  const params: unknown[] = [];

  if (docFilter?.length) {
    sql += ' AND doc_id IN (' + docFilter.map(() => '?').join(',') + ')';
    params.push(...docFilter);
  }

  const lowerQuery = query.toLowerCase();
  const tableKeywords = lowerQuery.split(/\s+/).filter(w => w.length > 3);
  if (tableKeywords.length > 0) {
    const likeClauses = tableKeywords.map(() => " (table_markdown LIKE ? OR caption LIKE ?) ");
    sql += ' AND (' + likeClauses.join(' OR ') + ')';
    for (const kw of tableKeywords) {
      params.push(`%${kw}%`, `%${kw}%`);
    }
  }

  sql += ' ORDER BY page_number LIMIT 5';
  const { results } = await env.DB.prepare(sql).bind(...params).all();

  return (results as Array<Record<string, unknown>>).map((r, i) => ({
    chunkId: `${r.id}`,
    docId: `${r.doc_id}`,
    content: `\n[TABEL ${r.caption || ''}]\n${r.table_markdown || ''}`,
    contentType: 'table',
    pageNumber: (r.page_number as number) || 1,
    sectionTitle: (r.caption as string) || 'Tabel',
    score: 0.75 - (i * 0.05),
    source: 'fusion' as const,
  }));
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
