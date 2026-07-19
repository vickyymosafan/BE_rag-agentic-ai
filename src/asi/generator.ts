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
