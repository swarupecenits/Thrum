import type { Db, SqlValue } from '@/db/adapter';

type Statement = { all(...params: SqlValue[]): unknown[]; run(...params: SqlValue[]): unknown };
type RawDb = { exec(sql: string): void; prepare(sql: string): Statement; close(): void };

// Node's built-in SQLite (Node 22.5+), loaded lazily so app code never sees Node types.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- a typed import would need @types/node app-wide
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => RawDb };

/** In-memory SQLite for Jest, with the same semantics as the native adapter. */
export function memoryDb(): Db & { raw: RawDb } {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  let depth = 0;
  return {
    raw,
    exec: async (sql) => {
      raw.exec(sql);
    },
    all: async <T,>(sql: string, params: readonly SqlValue[] = []) => raw.prepare(sql).all(...params) as T[],
    run(sql, params = []) {
      raw.prepare(sql).run(...params);
    },
    tx(fn) {
      if (depth > 0) return fn();
      depth += 1;
      raw.exec('BEGIN');
      try {
        fn();
        raw.exec('COMMIT');
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      } finally {
        depth -= 1;
      }
    },
    flush: async () => undefined,
    close: async () => raw.close(),
  };
}