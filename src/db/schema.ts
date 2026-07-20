export const DB_SCHEMA = {
  documents: `
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      filename TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('pdf', 'docx')),
      total_pages INTEGER DEFAULT 0,
      total_images INTEGER DEFAULT 0,
      total_tables INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'ready', 'error', 'deleted')),
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      is_active INTEGER NOT NULL DEFAULT 1
    )
  `,
  chunks: `
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL REFERENCES documents(id),
      content TEXT NOT NULL,
      content_type TEXT NOT NULL CHECK(content_type IN ('text', 'table', 'image_ref', 'hybrid')),
      page_number INTEGER,
      section_title TEXT,
      section_hierarchy TEXT,
      chunk_index INTEGER NOT NULL,
      embedding_id TEXT,
      metadata TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      is_active INTEGER NOT NULL DEFAULT 1
    )
  `,
  chunks_fts: `
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      content, section_title,
      content='chunks', content_rowid='rowid'
    )
  `,
  extracted_tables: `
    CREATE TABLE IF NOT EXISTS extracted_tables (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL REFERENCES documents(id),
      chunk_id TEXT REFERENCES chunks(id),
      page_number INTEGER,
      caption TEXT,
      table_data TEXT NOT NULL,
      table_markdown TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `,
  extracted_images: `
    CREATE TABLE IF NOT EXISTS extracted_images (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL REFERENCES documents(id),
      chunk_id TEXT REFERENCES chunks(id),
      page_number INTEGER,
      caption TEXT,
      r2_key TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'image/png',
      width INTEGER,
      height INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `,
  document_versions: `
    CREATE TABLE IF NOT EXISTS document_versions (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL REFERENCES documents(id),
      version INTEGER NOT NULL,
      filename TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      change_summary TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `,
  indexes: [
    `CREATE INDEX IF NOT EXISTS idx_chunks_doc_id ON chunks(doc_id)`,
    `CREATE INDEX IF NOT EXISTS idx_chunks_content_type ON chunks(content_type)`,
    `CREATE INDEX IF NOT EXISTS idx_chunks_page ON chunks(doc_id, page_number)`,
    `CREATE INDEX IF NOT EXISTS idx_tables_doc_id ON extracted_tables(doc_id)`,
    `CREATE INDEX IF NOT EXISTS idx_images_doc_id ON extracted_images(doc_id)`,
    `CREATE INDEX IF NOT EXISTS idx_doc_versions_doc_id ON document_versions(doc_id)`,
  ],
} as const;
