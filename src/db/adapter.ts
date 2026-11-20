export type SqlValue = string | number | null;
export type SqlRow = Record<string, SqlValue>;

/**
 * Storage port. Everything is read once at start-up and then served from memory by the stores,
 * so at runtime the app only writes: synchronously on native, through an ordered queue on web.
 */
export interface Db {
  exec(sql: string): Promise<void>;
  all<T = SqlRow>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  run(sql: string, params?: readonly SqlValue[]): void;
  /** Runs every `run` inside `fn` atomically. Nested calls join the outer transaction. */
  tx(fn: () => void): void;
  /** Resolves once queued writes are stored. */
  flush(): Promise<void>;
  close(): Promise<void>;
}

let current: Db | null = null;

export function setDb(next: Db | null) {
  current = next;
}

export function db(): Db {
  if (!current) throw new Error('The database is not open yet.');
  return current;
}
