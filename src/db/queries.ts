import type { CloudflareBindings, RetrievalResult } from '../types';

const VECTOR_QUERY = `
  SELECT chunk_id, doc_id, content, content_type, page_number, section_title, score
  FROM chunks
  WHERE rowid IN (
    SELECT rowid FROM vector_distance($1, $2)
    ORDER BY distance ASC
    LIMIT $3
  )
`;

export async function vectorSearch(
  embedding: number[],
  topK: number,
  env: CloudflareBindings,
  docFilter?: string[]
): Promise<RetrievalResult[]> {
  const vectorQuery = await env.VECTORIZE.query(embedding, {
    topK,
    filter: docFilter?.length ? { docId: { $in: docFilter } } : undefined,
    returnValues: true,
    returnMetadata: true,
  });

  const results: RetrievalResult[] = [];
  for (const match of vectorQuery.matches) {
    const meta = match.metadata as Record<string, string> | undefined;
    results.push({
      chunkId: match.id,
      docId: meta?.docId || '',
      content: (match.values as unknown as string) || '',
      contentType: meta?.contentType || 'text',
      pageNumber: parseInt(meta?.pageNumber || '0'),
      sectionTitle: meta?.sectionTitle || '',
      score: match.score,
      source: 'vector',
    });
  }

  return results;
}

export async function bm25Search(
  query: string,
  topK: number,
  env: CloudflareBindings
): Promise<RetrievalResult[]> {
  const stmt = env.DB.prepare(
    `SELECT c.id as chunk_id, c.doc_id, c.content, c.content_type,
            c.page_number, c.section_title, rank as score
     FROM chunks_fts
     JOIN chunks ON chunks_fts.rowid = chunks.rowid
     WHERE chunks_fts MATCH ?
     ORDER BY rank
     LIMIT ?`
  );
  const { results } = await stmt.bind(query, topK).all();

  return (results as Array<{
    chunk_id: string; doc_id: string; content: string;
    content_type: string; page_number: number; section_title: string; score: number;
  }>).map(r => ({
    chunkId: r.chunk_id,
    docId: r.doc_id,
    content: r.content,
    contentType: r.content_type,
    pageNumber: r.page_number,
    sectionTitle: r.section_title,
    score: r.score,
    source: 'bm25' as const,
  }));
}

export async function getDocumentTitle(docId: string, env: CloudflareBindings): Promise<string> {
  const stmt = env.DB.prepare('SELECT title FROM documents WHERE id = ? AND is_active = 1');
  const result = await stmt.bind(docId).first();
  return (result as { title: string } | null)?.title || docId;
}
