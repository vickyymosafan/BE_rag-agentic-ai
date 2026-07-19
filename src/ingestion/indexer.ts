import type { CloudflareBindings } from '../types';
import { embedQuery } from '../utils/embedding';

interface IndexChunk {
  id: string;
  docId: string;
  content: string;
  contentType: string;
  pageNumber: number;
  sectionTitle: string;
  chunkIndex: number;
}

export async function indexChunks(
  chunks: IndexChunk[],
  env: CloudflareBindings
): Promise<{ indexed: number; failed: number }> {
  let indexed = 0;
  let failed = 0;

  for (const chunk of chunks) {
    try {
      const embedding = await embedQuery(chunk.content, env);

      const vectorId = `vec:${chunk.id}`;
      await env.VECTORIZE.upsert([{
        id: vectorId,
        values: embedding,
        metadata: {
          docId: chunk.docId,
          chunkId: chunk.id,
          pageNumber: chunk.pageNumber,
          sectionTitle: chunk.sectionTitle,
          contentType: chunk.contentType,
        },
      }]);

      await env.DB.prepare(
        `INSERT OR REPLACE INTO chunks (id, doc_id, content, content_type, page_number, section_title, chunk_index, embedding_id, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
      ).bind(
        chunk.id,
        chunk.docId,
        chunk.content,
        'text',
        chunk.pageNumber,
        chunk.sectionTitle,
        chunk.chunkIndex,
        vectorId,
      ).run();

      indexed++;
    } catch (err) {
      console.error(`Failed to index chunk ${chunk.id}:`, err);
      failed++;
    }
  }

  return { indexed, failed };
}
