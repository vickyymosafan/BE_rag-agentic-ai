import type { CloudflareBindings, CriticResult } from '../types';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

export async function selfCritic(
  query: string,
  answer: string,
  context: string,
  env: CloudflareBindings
): Promise<CriticResult> {
  const apiKey = env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not configured');

  const res = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'qwen-3b-8096',
      messages: [
        {
          role: 'system',
          content: `Anda adalah evaluator jawaban RAG. Evaluasi ketat berdasarkan konteks.
Output JSON: { "score": 0.0-1.0, "issues": ["..."], "verdict": "pass/retry/abstain" }

Kriteria:
- score = rata-rata dari: (1) Apakah setiap klaim didukung konteks? (2) Apakah sumber dicantumkan? (3) Apakah tidak ada halusinasi? (4) Apakah abstain jika tidak ditemukan?
- verdict "abstain" jika score < 0.4
- verdict "retry" jika 0.4-0.7
- verdict "pass" jika > 0.7`,
        },
        {
          role: 'user',
          content: `Evaluasi jawaban berikut:

--- QUERY ---
${query.slice(0, 500)}

--- KONTEKS ---
${context.slice(0, 2000)}

--- JAWABAN ---
${answer.slice(0, 2000)}

Output JSON.`,
        },
      ],
      temperature: 0.2,
      max_tokens: 500,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('Groq Critic error:', err);
    return { score: 0.5, issues: ['Critic service unavailable'], verdict: 'retry' };
  }

  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  try {
    const output = JSON.parse(data.choices[0].message.content) as CriticResult;
    return {
      score: Math.max(0, Math.min(1, output.score || 0.5)),
      issues: output.issues || [],
      verdict: output.verdict || 'retry',
    };
  } catch {
    return { score: 0.5, issues: ['Failed to parse critic output'], verdict: 'retry' };
  }
}
