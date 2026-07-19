import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { CloudflareBindings, QueryRequest, QueryResponse } from './types';
import { classifyQuery } from './asi/classifier';
import { rewriteAndExpand } from './asi/rewriter';
import { adaptiveRetrieve } from './asi/retrieval';
import { generateAnswer } from './asi/generator';
import { shouldAnswer, shouldAbstain, buildCitations, validateGrounding } from './asi/grounding';
import { getFromCache, setCache } from './asi/cache';
import { rateLimitMiddleware } from './middleware/rate-limiter';
import { callWithFallback } from './asi/router';
import { decomposeQuery } from './asi/sub-question';
import { selfCritic } from './asi/critic';
import { correctiveRAG } from './asi/corrective';
import { trackRPDCall, checkRPDLimit, getRPDStats } from './utils/rpd-tracker';
import { getTopCachedQueries } from './asi/cache';
import {
  listDocuments,
  getDocument,
  createDocument,
  softDeleteDocument,
  getDocumentVersions,
} from './db/admin-queries';

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.use('/api/*', rateLimitMiddleware);

// === Admin: Document Management ===

app.get('/api/admin/documents', async (c) => {
  const docs = await listDocuments(c.env);
  return c.json({ documents: docs });
});

app.get('/api/admin/documents/:id', async (c) => {
  const doc = await getDocument(c.req.param('id'), c.env);
  if (!doc) return c.json({ error: 'Document not found' }, 404);
  return c.json({ document: doc });
});

app.post('/api/admin/documents', zValidator('json', z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  filename: z.string().min(1),
  type: z.string().min(1),
})), async (c) => {
  const { id, title, filename, type } = c.req.valid('json');
  await createDocument({ id, title, filename, type }, c.env);
  return c.json({ success: true, id }, 201);
});

app.delete('/api/admin/documents/:id', async (c) => {
  await softDeleteDocument(c.req.param('id'), c.env);
  return c.json({ success: true });
});

app.get('/api/admin/documents/:id/versions', async (c) => {
  const versions = await getDocumentVersions(c.req.param('id'), c.env);
  return c.json({ versions });
});

// === Admin: Usage Analytics ===

app.get('/api/admin/stats/rpd', async (c) => {
  const days = parseInt(c.req.query('days') || '7', 10);
  const stats = await getRPDStats(c.env, Math.min(days, 30));
  return c.json({ stats });
});

app.get('/api/admin/cache/top', async (c) => {
  const limit = parseInt(c.req.query('limit') || '10', 10);
  const top = await getTopCachedQueries(c.env, Math.min(limit, 50));
  return c.json({ queries: top });
});

const querySchema = z.object({
  query: z.string().min(1).max(1000),
  userId: z.string().min(1),
  documentIds: z.array(z.string()).optional(),
});

const route = app.post('/api/rag/query', zValidator('json', querySchema), async (c) => {
  const { query, userId, documentIds } = c.req.valid('json') as QueryRequest;
  const env = c.env;
  const reasoningPath: string[] = [];

  try {
    const cached = await getFromCache(query, env);
    if (cached) {
      reasoningPath.push('Cache hit: L1 exact match');
      return c.json({
        ...cached,
        reasoningPath: [...cached.reasoningPath, ...reasoningPath],
      } as QueryResponse);
    }

    const geminiBudget = await checkRPDLimit('gemini', env);
    if (!geminiBudget.allowed) {
      return c.json({
        answer: 'Maaf, kuota API harian untuk layanan primary telah habis. Silakan coba lagi besok.',
        citations: [],
        confidence: 0,
        asiScore: 0,
        reasoningPath: ['Gemini RPD limit reached'],
        sources: [],
      } as QueryResponse, 429);
    }

    const groqBudget = await checkRPDLimit('groq', env);
    if (!groqBudget.allowed) {
      return c.json({
        answer: 'Maaf, kuota preprocessing harian telah habis. Silakan coba lagi besok.',
        citations: [],
        confidence: 0,
        asiScore: 0,
        reasoningPath: ['Groq RPD limit reached'],
        sources: [],
      } as QueryResponse, 429);
    }

    const queryType = classifyQuery(query);
    reasoningPath.push(`Query classified as: ${queryType}`);

    const decomposed = queryType === 'complex'
      ? await callWithFallback(
          () => decomposeQuery(query, env),
          async () => [query],
          'groq',
          10000
        )
      : [query];
    if (decomposed.length > 1) {
      await trackRPDCall('groq', env);
      reasoningPath.push(`Decomposed: ${decomposed.length} sub-questions`);
    }

    const { rewritten, variants } = await callWithFallback(
      () => rewriteAndExpand(query, queryType, env),
      async () => ({ rewritten: query, variants: [query] }),
      'groq',
      10000
    );
    await trackRPDCall('groq', env);
    reasoningPath.push(`Rewritten: '${rewritten}'`);
    if (variants.length > 0) reasoningPath.push(`Expanded: ${variants.length + 1} semantic variants`);

    const searchQueries = [...decomposed, rewritten, ...variants].filter(Boolean);
    const allResults = await Promise.all(
      searchQueries.map(q => adaptiveRetrieve(q, queryType, env, documentIds))
    );
    const flatResults = allResults.flat().sort((a, b) => b.score - a.score);
    const topResults = flatResults.slice(0, 10);
    reasoningPath.push(`Hybrid retrieval: ${topResults.length} chunks retrieved`);

    if (shouldAbstain(topResults)) {
      reasoningPath.push('Retrieval score below abstain threshold (< 0.55)');
      return c.json({
        answer: 'Maaf, informasi yang Anda tanyakan tidak ditemukan dalam dokumen yang tersedia.',
        citations: [],
        confidence: 0,
        asiScore: 0,
        reasoningPath,
        sources: [],
      } as QueryResponse);
    }

    const { citations, sources, context } = await buildCitations(topResults, env);
    reasoningPath.push(`Citations built: ${citations.length} sources`);

    const generateFn = () => generateAnswer(query, context, citations.map(c => `${c.docName}, Hal ${c.page}`), env);

    let answer = await callWithFallback(
      async () => {
        const result = await generateFn();
        await trackRPDCall('gemini', env);
        return result;
      },
      async () => {
        reasoningPath.push('Fallback: Groq emergency generate');
        return `[Maaf, layanan primary tidak tersedia]\n\nBerdasarkan dokumen yang tersedia:\n\n${context.slice(0, 1000)}`;
      },
      'gemini',
      15000
    );

    const { score: groundingScore, isGrounded } = validateGrounding(answer, context);
    reasoningPath.push(`Grounding score: ${groundingScore.toFixed(2)} (${isGrounded ? 'pass' : 'fail'})`);

    let finalAnswer = answer;
    let finalScore = Math.min(topResults[0]?.score || 0, groundingScore);

    let criticResult = await callWithFallback(
      async () => {
        const result = await selfCritic(query, answer, context, env);
        await trackRPDCall('groq', env);
        return result;
      },
      async () => ({ score: 0.5, issues: ['Critic unavailable'], verdict: 'retry' as const }),
      'groq',
      10000
    );
    reasoningPath.push(`Self-critic score: ${criticResult.score.toFixed(2)} (${criticResult.verdict})`);

    let retryCount = 0;
    while (criticResult.verdict === 'retry' && retryCount < 2) {
      retryCount++;
      reasoningPath.push(`Corrective RAG attempt ${retryCount}`);

      const correctiveAction = await callWithFallback(
        async () => {
          const result = await correctiveRAG(query, {
            strategy: criticResult.issues.join(', '),
            score: criticResult.score,
            issues: criticResult.issues,
          }, env);
          await trackRPDCall('groq', env);
          return result;
        },
        async () => ({ strategy: 'rewrite' as const, adjusted_query: query }),
        'groq',
        10000
      );
      reasoningPath.push(`Corrective strategy: ${correctiveAction.strategy}`);

      const retryContext = context;
      const retryAnswer = await callWithFallback(
        async () => {
          const result = await generateAnswer(correctiveAction.adjusted_query || query, retryContext, citations.map(c => `${c.docName}, Hal ${c.page}`), env);
          await trackRPDCall('gemini', env);
          return result;
        },
        async () => answer,
        'gemini',
        15000
      );

      const { score: retryGroundingScore } = validateGrounding(retryAnswer, retryContext);
      criticResult = await callWithFallback(
        async () => {
          const result = await selfCritic(correctiveAction.adjusted_query || query, retryAnswer, retryContext, env);
          await trackRPDCall('groq', env);
          return result;
        },
        async () => ({ score: retryGroundingScore, issues: [], verdict: retryGroundingScore >= 0.7 ? 'pass' as const : 'abstain' as const }),
        'groq',
        10000
      );
      reasoningPath.push(`Corrective retry ${retryCount} score: ${criticResult.score.toFixed(2)} (${criticResult.verdict})`);

      if (criticResult.score > (criticResult.verdict === 'pass' ? 0 : groundingScore)) {
        answer = retryAnswer;
        finalScore = criticResult.score;
      }
    }

    if (!isGrounded && groundingScore < 0.8 && retryCount === 0) {
      reasoningPath.push('Regeneration: grounding score < 0.8, retrying with stricter prompt');
      const strictPrompt = `${answer}\n\nPERINGATAN: Jawaban di atas mengandung klaim yang tidak didukung konteks.\nHanya gunakan informasi dari konteks berikut:\n${context}`;

      const regenerateFn = () => generateAnswer(query, context + '\n' + strictPrompt, citations.map(c => `${c.docName}, Hal ${c.page}`), env);
      const retryAnswer = await callWithFallback(
        regenerateFn,
        async () => answer,
        'gemini',
        15000
      );

      const { score: retryScore } = validateGrounding(retryAnswer, context);
      finalAnswer = retryScore > groundingScore ? retryAnswer : answer;
      finalScore = Math.max(retryScore, groundingScore);
      reasoningPath.push(`Regeneration score: ${Math.max(retryScore, groundingScore).toFixed(2)}`);
    }

    if (criticResult.verdict === 'abstain') {
      finalAnswer = 'Maaf, saya tidak dapat memberikan jawaban yang akurat berdasarkan dokumen yang tersedia. Silakan periksa ulang pertanyaan Anda atau konsultasi dengan staff akademik.';
      finalScore = 0;
    } else {
      finalAnswer = answer;
      finalScore = Math.max(groundingScore, criticResult.score);
    }
    const asiScore = (finalScore + (shouldAnswer(topResults) ? 1 : 0)) / 2;
    reasoningPath.push(`ASI score: ${asiScore.toFixed(2)}`);

    const response: QueryResponse = {
      answer: finalAnswer,
      citations,
      confidence: finalScore,
      asiScore,
      reasoningPath,
      sources,
    };

    const cacheEntry = {
      query,
      queryEmbedding: [],
      response: finalAnswer,
      citations,
      score: finalScore,
      asiScore,
      reasoningPath,
      sources,
      timestamp: Date.now(),
      hitCount: 1,
    };
    await setCache(query, cacheEntry, env);

    return c.json(response);
  } catch (err) {
    console.error('Query error:', err);
    reasoningPath.push(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    return c.json({
      answer: 'Maaf, terjadi kesalahan sistem. Silakan coba lagi.',
      citations: [],
      confidence: 0,
      asiScore: 0,
      reasoningPath,
      sources: [],
    } as QueryResponse, 500);
  }
});

export type AppType = typeof route;
export default app;
