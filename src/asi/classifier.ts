import type { QueryType } from '../types';

const IMAGE_KEYWORDS = ['gambar', 'diagram', 'foto', 'fotografi', 'ilustrasi', 'skema', 'chart', 'grafik', 'visual', 'denah', 'bagan'];
const TABLE_KEYWORDS = ['tabel', 'kolom', 'baris', 'data', 'angka', 'statistik', 'matriks', 'spreadsheet'];
const COMPLEX_INDICATORS = ['dan', 'juga', 'serta', 'bandingkan', 'perbedaan', 'persamaan', 'lalu', 'kemudian', 'setelah itu', 'selain itu'];

export function classifyQuery(query: string): QueryType {
  const lower = query.toLowerCase();

  if (COMPLEX_INDICATORS.filter(w => lower.includes(w)).length >= 2) {
    return 'complex';
  }

  const hasImage = IMAGE_KEYWORDS.some(w => lower.includes(w));
  const hasTable = TABLE_KEYWORDS.some(w => lower.includes(w));

  if (hasImage && hasTable) return 'hybrid';
  if (hasImage) return 'image';
  if (hasTable) return 'table';

  return 'text';
}
