import type { CloudflareBindings } from '../types';

export async function listDocuments(env: CloudflareBindings): Promise<Array<Record<string, unknown>>> {
  const { results } = await env.DB.prepare(
    'SELECT id, title, filename, type, total_pages, total_images, total_tables, status, version, created_at, updated_at FROM documents WHERE is_active = 1 ORDER BY updated_at DESC'
  ).all();
  return results;
}

export async function getDocument(id: string, env: CloudflareBindings): Promise<Record<string, unknown> | null> {
  return env.DB.prepare(
    'SELECT * FROM documents WHERE id = ? AND is_active = 1'
  ).bind(id).first();
}

export async function createDocument(
  doc: { id: string; title: string; filename: string; type: string },
  env: CloudflareBindings
): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO documents (id, title, filename, type, status) VALUES (?, ?, ?, ?, ?)'
  ).bind(doc.id, doc.title, doc.filename, doc.type, 'pending').run();
}

export async function updateDocumentStatus(
  id: string,
  status: string,
  env: CloudflareBindings
): Promise<void> {
  await env.DB.prepare(
    "UPDATE documents SET status = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(status, id).run();
}

export async function softDeleteDocument(id: string, env: CloudflareBindings): Promise<void> {
  await env.DB.prepare(
    'UPDATE documents SET is_active = 0, status = ? WHERE id = ?'
  ).bind('deleted', id).run();

  await env.DB.prepare(
    'UPDATE chunks SET is_active = 0 WHERE doc_id = ?'
  ).bind(id).run();
}

export async function createDocumentVersion(
  ver: { id: string; docId: string; version: number; filename: string; fileHash: string; changeSummary?: string },
  env: CloudflareBindings
): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO document_versions (id, doc_id, version, filename, file_hash, change_summary) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(ver.id, ver.docId, ver.version, ver.filename, ver.fileHash, ver.changeSummary || null).run();

  await env.DB.prepare(
    "UPDATE documents SET version = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(ver.version, ver.docId).run();
}

export async function getDocumentVersions(docId: string, env: CloudflareBindings): Promise<Array<Record<string, unknown>>> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM document_versions WHERE doc_id = ? ORDER BY version DESC'
  ).bind(docId).all();
  return results;
}
