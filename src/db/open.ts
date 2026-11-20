import { openDatabaseAsync, type SQLiteBindValue, type SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';

import type { Db } from './adapter';

export const DB_NAME = 'thrum.db';

type Statement = { sql: string; params: SQLiteBindValue[] };

export async function openDb(onWriteError: (error: unknown) => void): Promise<Db> {
  const sqlite = await openDatabaseAsync(DB_NAME);
  if (Platform.OS !== 'web') await sqlite.execAsync('PRAGMA journal_mode = WAL;');
  await sqlite.execAsync('PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;');
  return Platform.OS === 'web' ? queued(sqlite, onWriteError) : direct(sqlite);
}

function direct(sqlite: SQLiteDatabase): Db {
  let depth = 0;
  return {
    exec: (sql) => sqlite.execAsync(sql),
    all: (sql, params = []) => sqlite.getAllAsync(sql, [...params]),
    run(sql, params = []) {
      sqlite.runSync(sql, [...params]);
    },
    tx(fn) {
      if (depth > 0) return fn();
      depth += 1;
      try {
        sqlite.withTransactionSync(fn);
      } finally {
        depth -= 1;
      }
    },
    flush: () => Promise.resolve(),
    close: () => sqlite.closeAsync(),
  };
}

/**
 * On web the synchronous API busy-waits on the main thread and caps results at 1 MB, so writes
 * are applied in order on a background queue instead. Reads only happen at start-up.
 */
function queued(sqlite: SQLiteDatabase, onWriteError: (error: unknown) => void): Db {
  let chain: Promise<void> = Promise.resolve();
  let batch: Statement[] | null = null;

  const enqueue = (statements: Statement[]) => {
    chain = chain
      .then(async () => {
        if (statements.length === 1) {
          await sqlite.runAsync(statements[0].sql, statements[0].params);
          return;
        }
        // The queue is strictly serial, so nothing can interleave with this transaction.
        await sqlite.withTransactionAsync(async () => {
          for (const s of statements) await sqlite.runAsync(s.sql, s.params);
        });
      })
      .catch(onWriteError);
  };

  return {
    exec: async (sql) => {
      await chain;
      await sqlite.execAsync(sql);
    },
    all: async (sql, params = []) => {
      await chain;
      return sqlite.getAllAsync(sql, [...params]);
    },
    run(sql, params = []) {
      const statement = { sql, params: [...params] };
      if (batch) batch.push(statement);
      else enqueue([statement]);
    },
    tx(fn) {
      if (batch) return fn();
      batch = [];
      try {
        fn();
        const statements = batch;
        batch = null;
        if (statements.length) enqueue(statements);
      } catch (error) {
        batch = null;
        throw error;
      }
    },
    flush: () => chain,
    close: async () => {
      await chain;
      await sqlite.closeAsync();
    },
  };
}
