import type { CloudflareBindings } from '../types';

interface ParseResult {
  text: string;
  pages: Array<{ pageNumber: number; text: string; images: string[]; tables: string[] }>;
  metadata: Record<string, unknown>;
}

export async function parseDocument(
  file: File,
  docId: string,
  env: CloudflareBindings
): Promise<ParseResult> {
  const filename = file.name.toLowerCase();

  if (filename.endsWith('.docx')) {
    return parseDocx(file, docId, env);
  }
  if (filename.endsWith('.pdf')) {
    return parsePdf(file, docId, env);
  }
  throw new Error(`Unsupported file type: ${filename}`);
}

async function parseDocx(file: File, docId: string, env: CloudflareBindings): Promise<ParseResult> {
  const { extractRawText, convertToHtml } = await import('mammoth');
  const buffer = await file.arrayBuffer();
  const result = await extractRawText({ arrayBuffer: buffer });

  const pages = result.value.split(/\f|\n{3,}/).filter(Boolean).map((text, i) => ({
    pageNumber: i + 1,
    text: text.trim(),
    images: [] as string[],
    tables: [] as string[],
  }));

  const images = await extractDocxImages(buffer, docId, env);
  const tables = await extractDocxTables(buffer, docId, env, pages);

  if (images.length > 0 && pages.length > 0) {
    pages[0].images.push(...images);
  }

  return {
    text: result.value,
    pages,
    metadata: { format: 'docx', warnings: (result as any).warnings || [], imageCount: images.length, tableCount: tables.length },
  };
}

async function parsePdf(file: File, docId: string, env: CloudflareBindings): Promise<ParseResult> {
  const buffer = await file.arrayBuffer();
  const text = await extractTextFromPdf(buffer);
  const images = detectPdfImages(buffer, docId);

  const pages = text.split(/\f/).filter(Boolean).map((text, i) => ({
    pageNumber: i + 1,
    text: text.trim(),
    images: [] as string[],
    tables: [] as string[],
  }));

  if (images.length > 0 && pages.length > 0) {
    pages[0].images.push(...images);
  }

  return {
    text,
    pages,
    metadata: { format: 'pdf', pageCount: pages.length, imageCount: images.length },
  };
}

async function extractDocxImages(buffer: ArrayBuffer, docId: string, env: CloudflareBindings): Promise<string[]> {
  const { convertToHtml } = await import('mammoth');
  const images: string[] = [];
  let imgIndex = 0;

  const htmlResult = await (convertToHtml as any)({
    arrayBuffer: buffer,
    convertImage: async (img: { stream: () => Promise<ReadableStream>; contentType: string | null }) => {
      const imgId = `${docId}:img:${imgIndex++}`;
      const stream = await img.stream();
      await env.R2_IMAGES.put(`images/${docId}/${imgId}`, stream, {
        httpMetadata: { contentType: img.contentType || 'image/png' },
      });
      images.push(imgId);
      return { src: '' };
    },
  });

  return images;
}

async function extractDocxTables(buffer: ArrayBuffer, docId: string, env: CloudflareBindings, pages: ParseResult['pages']): Promise<string[]> {
  const raw = new TextDecoder().decode(buffer);
  const tableIds: string[] = [];
  const lines = raw.split('\n');
  let currentPage = 0;
  let inTable = false;
  let tableBuffer: string[] = [];

  for (const line of lines) {
    if (line.includes('\f')) currentPage++;
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      inTable = true;
      tableBuffer.push(line.trim());
    } else if (inTable && tableBuffer.length > 0) {
      if (tableBuffer.length >= 2) {
        const tableMarkdown = tableBuffer.join('\n');
        const tableId = `${docId}:tbl:${Date.now()}:${tableIds.length}`;
        await env.DB.prepare(
          `INSERT INTO extracted_tables (id, doc_id, page_number, table_data, table_markdown) VALUES (?, ?, ?, ?, ?)`
        ).bind(tableId, docId, currentPage, tableMarkdown, tableMarkdown).run();
        tableIds.push(tableId);
        if (pages[currentPage]) pages[currentPage].tables.push(tableId);
      }
      tableBuffer = [];
      inTable = false;
    }
  }

  return tableIds;
}

function detectPdfImages(buffer: ArrayBuffer, docId: string): string[] {
  const raw = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  const images: string[] = [];
  const imgRefs = raw.match(/\/Im\d+\s+\d+\s+\d+\s+R/g) || [];
  for (let i = 0; i < Math.min(imgRefs.length, 20); i++) {
    images.push(`${docId}:img:pdf:${i}`);
  }
  return images;
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
