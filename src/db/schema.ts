import type { Db } from './adapter';

const V1 = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  played_ms INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS plays_started ON plays (started_at);
CREATE TABLE IF NOT EXISTS favorites (
  track_id TEXT PRIMARY KEY NOT NULL,
  added_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS playlists (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  track_ids TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS features (
  track_id TEXT PRIMARY KEY NOT NULL,
  modified INTEGER NOT NULL,
  data TEXT,
  error TEXT,
  analyzed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS library_cache (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  raw TEXT NOT NULL,
  scanned_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS searches (
  query TEXT PRIMARY KEY NOT NULL,
  at INTEGER NOT NULL
);
`;

const MIGRATIONS = [V1];

export const SCHEMA_VERSION = MIGRATIONS.length;

/** Applies pending migrations, each in its own transaction, tracked with `PRAGMA user_version`. */
export async function migrate(db: Db): Promise<number> {
  const [row] = await db.all<{ user_version: number }>('PRAGMA user_version');
  let version = Number(row?.user_version ?? 0);
  if (version > SCHEMA_VERSION) {
    throw new Error('This data was saved by a newer version of Thrum. Update the app to open it.');
  }
  while (version < SCHEMA_VERSION) {
    const next = version + 1;
    try {
      await db.exec(`BEGIN;\n${MIGRATIONS[version]}\nPRAGMA user_version = ${next};\nCOMMIT;`);
    } catch (error) {
      await db.exec('ROLLBACK;').catch(() => undefined);
      throw error;
    }
    version = next;
  }
  return version;
}
