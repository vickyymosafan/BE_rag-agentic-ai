import type { DurableObjectNamespace, DurableObject } from '@cloudflare/workers-types';

export interface CloudflareBindings {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  KV_CACHE: KVNamespace;
  R2_IMAGES: R2Bucket;
  RATE_LIMITER: DurableObjectNamespace;
  ENVIRONMENT: string;
  GEMINI_API_KEY?: string;
  GROQ_API_KEY?: string;
  COHERE_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  JWT_SECRET?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
}

export type QueryType = 'text' | 'image' | 'table' | 'complex' | 'hybrid';

export interface QueryRequest {
  query: string;
  userId: string;
  documentIds?: string[];
}

export interface QueryResponse {
  answer: string;
  citations: Citation[];
  confidence: number;
  asiScore: number;
  reasoningPath: string[];
  sources: Source[];
}

export interface Citation {
  docName: string;
  page: number;
  text: string;
}

export interface Source {
  docId: string;
  page: number;
  chunkId: string;
}

export interface RetrievalResult {
  chunkId: string;
  docId: string;
  content: string;
  contentType: string;
  pageNumber: number;
  sectionTitle: string;
  score: number;
  source: 'vector' | 'bm25' | 'fusion' | 'rerank';
}

export interface CacheEntry {
  query: string;
  queryEmbedding: number[];
  response: string;
  citations: Citation[];
  score: number;
  asiScore: number;
  reasoningPath: string[];
  sources: Source[];
  timestamp: number;
  hitCount: number;
}

export interface CriticResult {
  score: number;
  issues: string[];
  verdict: 'pass' | 'retry' | 'abstain';
}

export interface CorrectiveAction {
  strategy: 'rewrite' | 'hybrid' | 'bm25_only' | 'decompose';
  adjusted_query: string;
}

export interface RewriterOutput {
  rewritten: string;
  variants: string[];
}

export class RateLimiterDO {
  state: DurableObjectState;
  count: number;
  resetTime: number;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.count = 0;
    this.resetTime = Date.now() + 60000;
  }

  async fetch(request: Request): Promise<Response> {
    const now = Date.now();
    if (now > this.resetTime) {
      this.count = 0;
      this.resetTime = now + 60000;
    }
    this.count++;
    const allowed = this.count <= 20;
    return new Response(JSON.stringify({ allowed, count: this.count }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
