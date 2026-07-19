import type { RetrievalResult, Citation, Source } from '../types';
import type { CloudflareBindings } from '../types';
import { getDocumentTitle } from '../db/queries';

const THRESHOLD_ANSWER = 0.82;
const THRESHOLD_ABSTAIN = 0.55;

export function shouldAnswer(results: RetrievalResult[]): boolean {
  if (results.length === 0) return false;
  const topScore = results[0].score;
  return topScore >= THRESHOLD_ANSWER;
}

export function shouldAbstain(results: RetrievalResult[]): boolean {
  if (results.length === 0) return true;
  const topScore = results[0].score;
  return topScore < THRESHOLD_ABSTAIN;
}

export function jaccardSimilarity(claim: string, context: string): number {
  const tokenize = (s: string) => {
    const words = s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
    return new Set(words);
  };
  const a = tokenize(claim);
  const b = tokenize(context);

  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection++;
  }

  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function exactPhraseMatch(claim: string, context: string): boolean {
  const phrases = claim.match(/[""]([^""]+)[""]/g) || [];
  if (phrases.length === 0) return true;
  const lowerContext = context.toLowerCase();
  return phrases.every(p => {
    const clean = p.replace(/[""]/g, '').toLowerCase().trim();
    return clean.length > 0 ? lowerContext.includes(clean) : true;
  });
}

export async function buildCitations(
  results: RetrievalResult[],
  env: CloudflareBindings
): Promise<{ citations: Citation[]; sources: Source[]; context: string }> {
  const citations: Citation[] = [];
  const sources: Source[] = [];
  const seen = new Set<string>();
  const contextParts: string[] = [];

  for (const r of results) {
    if (seen.has(r.chunkId)) continue;
    seen.add(r.chunkId);

    const docName = await getDocumentTitle(r.docId, env);

    citations.push({
      docName,
      page: r.pageNumber,
      text: r.content.slice(0, 200),
    });

    sources.push({
      docId: r.docId,
      page: r.pageNumber,
      chunkId: r.chunkId,
    });

    contextParts.push(`[${docName}, Hal ${r.pageNumber}]: ${r.content}`);
  }

  return {
    citations,
    sources,
    context: contextParts.join('\n\n'),
  };
}

export function validateGrounding(
  answer: string,
  context: string
): { score: number; isGrounded: boolean } {
  const jScore = jaccardSimilarity(answer, context);
  const phrasesMatch = exactPhraseMatch(answer, context);
  const score = jScore * (phrasesMatch ? 1 : 0.5);
  return { score, isGrounded: score >= 0.8 };
}
