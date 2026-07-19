interface Chunk {
  id: string;
  docId: string;
  content: string;
  pageNumber: number;
  sectionTitle: string;
  chunkIndex: number;
  tokenCount: number;
}

const MAX_TOKENS = 512;
const OVERLAP_TOKENS = 64;
const MIN_CHUNK_LENGTH = 50;

const SECTION_PATTERN = /^(BAB|BAGIAN|PASAL|LAMPIRAN|KETENTUAN|BAB\s+[IVXLCDM]+)/im;
const SUBSECTION_PATTERN = /^(?:Pasal\s+\d+|Bagian\s+(?:Kedua|Pertama|Ketiga|Keempat)|Bag\s+\d+|Sub-Bab\s+[\d.]+)/im;

export function chunkDocument(
  text: string,
  docId: string,
  pageNumber: number = 1
): Chunk[] {
  const sections = splitBySections(text);
  const chunks: Chunk[] = [];
  let chunkIndex = 0;

  for (const { sectionTitle, content } of sections) {
    const paragraphs = content
      .split(/\n\s*\n/)
      .map(p => p.trim())
      .filter(p => p.length >= MIN_CHUNK_LENGTH);

    let currentChunk = '';
    let currentTokens = 0;

    for (const para of paragraphs) {
      const paraTokens = estimateTokens(para);

      if (currentTokens + paraTokens > MAX_TOKENS && currentChunk.length > 0) {
        chunks.push(createChunk(currentChunk, docId, pageNumber, sectionTitle, chunkIndex++));
        const overlapText = getOverlapText(currentChunk);
        currentChunk = overlapText;
        currentTokens = estimateTokens(overlapText);
      }

      currentChunk += (currentChunk ? '\n\n' : '') + para;
      currentTokens = estimateTokens(currentChunk);
    }

    if (currentChunk.length >= MIN_CHUNK_LENGTH) {
      chunks.push(createChunk(currentChunk, docId, pageNumber, sectionTitle, chunkIndex++));
    }
  }

  return chunks;
}

function splitBySections(text: string): Array<{ sectionTitle: string; content: string }> {
  const lines = text.split('\n');
  const sections: Array<{ sectionTitle: string; content: string }> = [];
  let currentSection = 'Pendahuluan';
  let currentContent: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (SECTION_PATTERN.test(trimmed) || SUBSECTION_PATTERN.test(trimmed)) {
      if (currentContent.length > 0) {
        sections.push({ sectionTitle: currentSection, content: currentContent.join('\n') });
      }
      currentSection = trimmed;
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }

  if (currentContent.length > 0) {
    sections.push({ sectionTitle: currentSection, content: currentContent.join('\n') });
  }

  return sections;
}

function createChunk(
  content: string,
  docId: string,
  pageNumber: number,
  sectionTitle: string,
  chunkIndex: number
): Chunk {
  const id = `${docId}:chunk:${chunkIndex}`;
  return {
    id,
    docId,
    content: content.trim(),
    pageNumber,
    sectionTitle,
    chunkIndex,
    tokenCount: estimateTokens(content),
  };
}

function getOverlapText(text: string): string {
  const words = text.split(/\s+/);
  const overlapWordCount = Math.min(OVERLAP_TOKENS, words.length);
  return words.slice(-overlapWordCount).join(' ');
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
