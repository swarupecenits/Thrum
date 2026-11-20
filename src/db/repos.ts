import { db } from './adapter';
import type { Features, PlayEvent, Playlist } from '@/lib/types';

// Every table is read once at start-up; afterwards the stores only write.

export async function loadSettingsRows(): Promise<Record<string, string>> {
  const rows = await db().all<{ key: string; value: string }>('SELECT key, value FROM settings');
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export function saveSetting(key: string, value: unknown) {
  db().run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
    key,
    JSON.stringify(value),
  ]);
}

export function deleteSetting(key: string) {
  db().run('DELETE FROM settings WHERE key = ?', [key]);
}

type PlayRow = {
  track_id: string;
  started_at: number;
  played_ms: number;
  duration_ms: number;
  completed: number;
  skipped: number;
};

export async function loadPlays(): Promise<PlayEvent[]> {
  const rows = await db().all<PlayRow>(
    'SELECT track_id, started_at, played_ms, duration_ms, completed, skipped FROM plays ORDER BY started_at ASC, id ASC',
  );
  return rows.map((r) => ({
    trackId: String(r.track_id),
    startedAt: Number(r.started_at),
    playedMs: Number(r.played_ms),
    durationMs: Number(r.duration_ms),
    completed: !!r.completed,
    skipped: !!r.skipped,
  }));
}

export function insertPlay(ev: PlayEvent) {
  db().run(
    'INSERT INTO plays (track_id, started_at, played_ms, duration_ms, completed, skipped) VALUES (?, ?, ?, ?, ?, ?)',
    [ev.trackId, Math.round(ev.startedAt), Math.round(ev.playedMs), Math.round(ev.durationMs), ev.completed ? 1 : 0, ev.skipped ? 1 : 0],
  );
}

export function clearPlays() {
  db().run('DELETE FROM plays');
}

export async function loadFavorites(): Promise<{ trackId: string; addedAt: number }[]> {
  const rows = await db().all<{ track_id: string; added_at: number }>(
    'SELECT track_id, added_at FROM favorites ORDER BY added_at DESC',
  );
  return rows.map((r) => ({ trackId: String(r.track_id), addedAt: Number(r.added_at) }));
}

export function setFavoriteRow(trackId: string, on: boolean, at: number) {
  if (on) db().run('INSERT OR REPLACE INTO favorites (track_id, added_at) VALUES (?, ?)', [trackId, at]);
  else db().run('DELETE FROM favorites WHERE track_id = ?', [trackId]);
}

type PlaylistRow = { id: string; name: string; track_ids: string; created_at: number; updated_at: number };

function parseIds(json: string): string[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function loadPlaylists(): Promise<Playlist[]> {
  const rows = await db().all<PlaylistRow>(
    'SELECT id, name, track_ids, created_at, updated_at FROM playlists ORDER BY updated_at DESC',
  );
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    trackIds: parseIds(String(r.track_ids)),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  }));
}

export function savePlaylist(p: Playlist) {
  db().run(
    `INSERT INTO playlists (id, name, track_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, track_ids = excluded.track_ids, updated_at = excluded.updated_at`,
    [p.id, p.name, JSON.stringify(p.trackIds), p.createdAt, p.updatedAt],
  );
}

export function deletePlaylistRow(id: string) {
  db().run('DELETE FROM playlists WHERE id = ?', [id]);
}

export type FeatureRow = { trackId: string; modified: number; features: Features | null; error: string | null };

export async function loadFeatures(): Promise<FeatureRow[]> {
  const rows = await db().all<{ track_id: string; modified: number; data: string | null; error: string | null }>(
    'SELECT track_id, modified, data, error FROM features',
  );
  const out: FeatureRow[] = [];
  for (const r of rows) {
    let features: Features | null = null;
    if (r.data) {
      try {
        features = JSON.parse(String(r.data)) as Features;
      } catch {
        features = null;
      }
    }
    out.push({ trackId: String(r.track_id), modified: Number(r.modified), features, error: r.error ? String(r.error) : null });
  }
  return out;
}

export function saveFeatures(trackId: string, modified: number, features: Features | null, error: string | null) {
  db().run(
    'INSERT OR REPLACE INTO features (track_id, modified, data, error, analyzed_at) VALUES (?, ?, ?, ?, ?)',
    [trackId, modified, features ? JSON.stringify(features) : null, error, Date.now()],
  );
}

export function clearFeatures() {
  db().run('DELETE FROM features');
}

export async function loadLibraryCache(): Promise<{ raw: string; scannedAt: number } | null> {
  const [row] = await db().all<{ raw: string; scanned_at: number }>('SELECT raw, scanned_at FROM library_cache WHERE id = 1');
  return row ? { raw: String(row.raw), scannedAt: Number(row.scanned_at) } : null;
}

export function saveLibraryCache(raw: string, scannedAt: number) {
  db().run('INSERT OR REPLACE INTO library_cache (id, raw, scanned_at) VALUES (1, ?, ?)', [raw, scannedAt]);
}

export async function loadSearches(): Promise<string[]> {
  const rows = await db().all<{ query: string }>('SELECT query FROM searches ORDER BY at DESC LIMIT 12');
  return rows.map((r) => String(r.query));
}

export function saveSearch(query: string, at: number) {
  db().tx(() => {
    db().run('INSERT OR REPLACE INTO searches (query, at) VALUES (?, ?)', [query, at]);
    db().run('DELETE FROM searches WHERE query NOT IN (SELECT query FROM searches ORDER BY at DESC LIMIT 12)');
  });
}

export function clearSearches() {
  db().run('DELETE FROM searches');
}
