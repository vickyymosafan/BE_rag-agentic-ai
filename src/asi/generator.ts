import type { CloudflareBindings } from '../types';

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

export async function generateAnswer(
  query: string,
  context: string,
  citations: string[],
  env: CloudflareBindings
): Promise<string> {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  const systemPrompt = `Anda adalah asisten akademik untuk dokumen panduan TA, KP, KKN, dan Kurikulum Sistem Informasi.

ATURAN KETAT:
1. Jawab HANYA berdasarkan konteks dokumen yang diberikan di bawah.
2. JANGAN menambahkan informasi di luar konteks.
3. JIKA informasi tidak ditemukan dalam konteks, katakan "Maaf, informasi tersebut tidak ditemukan dalam dokumen yang tersedia."
4. Setiap klaim WAJIB menyertakan sumber: [Nama Dokumen, Hal X]
5. Gunakan format Markdown untuk struktur jawaban.
6. Jika ada tabel, tampilkan dalam format markdown.
7. Jika ada kode, tampilkan dalam code block dengan bahasa yang sesuai.`;

  const contextBlock = `--- KONTEKS DOKUMEN ---\n${context}\n\n--- CITATIONS ---\n${citations.join('\n')}`;

  const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { text: systemPrompt },
          { text: `KONTEKS:\n${contextBlock}\n\nPERTANYAAN: ${query}\n\nJawab dengan markdown:` },
        ],
      }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 2048,
        topP: 0.8,
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('Gemini Generate error:', err);
    throw new Error(`Generate failed: ${res.status}`);
  }

  const data = await res.json() as {
    candidates?: Array<{
      content?: { parts?: Array<{ text: string }> };
      finishReason?: string;
    }>;
  };

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    console.warn('Gemini returned empty response:', JSON.stringify(data));
    return 'Maaf, terjadi kesalahan saat menghasilkan jawaban.';
  }

  return text;
}

const COHERE_API_URL = 'https://api.cohere.ai/v1/chat';

export async function generateCohere(
  query: string,
  context: string,
  citations: string[],
  env: CloudflareBindings
): Promise<string> {
  const apiKey = env.COHERE_API_KEY;
  if (!apiKey) throw new Error('COHERE_API_KEY not configured');

  const res = await fetch(COHERE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'command-a-03-2025',
      message: query,
      documents: [{ text: context }],
      preamble: `Anda adalah asisten akademik. Jawab HANYA dari konteks yang diberikan.
Setiap klaim WAJIB menyertakan sumber: [Nama Dokumen, Hal X]
Jika informasi tidak ditemukan, katakan "Maaf, informasi tersebut tidak ditemukan dalam dokumen yang tersedia."
CITATION: ${citations.join('\n')}`,
      temperature: 0.2,
      max_tokens: 2048,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('Cohere Generate error:', err);
    throw new Error(`Cohere generate failed: ${res.status}`);
  }

  const data = await res.json() as { text?: string };
  return data.text || 'Maaf, terjadi kesalahan saat menghasilkan jawaban.';
}

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

export async function generateOpenRouter(
  query: string,
  context: string,
  citations: string[],
  env: CloudflareBindings
): Promise<string> {
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not configured');

  const systemPrompt = `Anda adalah asisten akademik. Jawab HANYA dari konteks yang diberikan.
Setiap klaim WAJIB menyertakan sumber.
Jika informasi tidak ditemukan, abstain.`;

  const res = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://rag-ai-agentic.vercel.app',
    },
    body: JSON.stringify({
      model: 'google/gemma-2-27b-it',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `KONTEKS:\n${context}\n\nPERTANYAAN: ${query}\n\nCITATIONS:\n${citations.join('\n')}` },
      ],
      temperature: 0.2,
      max_tokens: 2048,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('OpenRouter Generate error:', err);
    throw new Error(`OpenRouter generate failed: ${res.status}`);
  }

  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content || 'Maaf, terjadi kesalahan.';
}
