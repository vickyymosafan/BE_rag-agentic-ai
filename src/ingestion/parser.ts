import type { CloudflareBindings } from '../types';

interface ParseResult {
  text: string;
  pages: Array<{ pageNumber: number; text: string; images: string[]; tables: string[] }>;
  metadata: Record<string, unknown>;
}

export async function parseDocument(
  file: File,
  env: CloudflareBindings
): Promise<ParseResult> {
  const filename = file.name.toLowerCase();

  if (filename.endsWith('.docx')) {
    return parseDocx(file);
  }
  if (filename.endsWith('.pdf')) {
    return parsePdf(file);
  }
  throw new Error(`Unsupported file type: ${filename}`);
}

async function parseDocx(file: File): Promise<ParseResult> {
  const { extractRawText } = await import('mammoth');
  const buffer = await file.arrayBuffer();
  const result = await extractRawText({ arrayBuffer: buffer });

  const pages = result.value.split(/\f|\n{3,}/).filter(Boolean).map((text, i) => ({
    pageNumber: i + 1,
    text: text.trim(),
    images: [] as string[],
    tables: [] as string[],
  }));

  return {
    text: result.value,
    pages,
    metadata: { format: 'docx', warnings: (result as any).warnings || [] },
  };
}

async function parsePdf(file: File): Promise<ParseResult> {
  const buffer = await file.arrayBuffer();
  const text = await extractTextFromPdf(buffer);

  const pages = text.split(/\f/).filter(Boolean).map((text, i) => ({
    pageNumber: i + 1,
    text: text.trim(),
    images: [] as string[],
    tables: [] as string[],
  }));

  return {
    text,
    pages,
    metadata: { format: 'pdf', pageCount: pages.length },
  };
}

async function extractTextFromPdf(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const raw = decoder.decode(bytes);

  const textParts: string[] = [];
  const streamRegex = /stream\s*([\s\S]*?)\s*endstream/g;
  const textRegex = /(?:Tj|TJ|\(([^)]*)\))/g;

  let match: RegExpExecArray | null;
  while ((match = streamRegex.exec(raw)) !== null) {
    const streamData = match[1];
    const textMatch = streamData.match(textRegex);
    if (textMatch) {
      for (const t of textMatch) {
        const content = t.replace(/^\(|\)$/g, '');
        textParts.push(content);
      }
    }
  }

  return textParts.join(' ') || 'PDF text extraction limited. Gunakan pipeline eksternal untuk parsing lengkap.';
}
