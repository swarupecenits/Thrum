import { create } from 'zustand';

import { deletePlaylistRow, savePlaylist, setFavoriteRow } from '@/db/repos';
import type { Playlist } from '@/lib/types';
import { newId } from '@/utils/ids';
import { persist } from './persist';

type CollectionsState = {
  favorites: Set<string>;
  /** Favourites, newest first. */
  favoriteOrder: string[];
  playlists: Playlist[];
};

export const useCollections = create<CollectionsState>()(() => ({
  favorites: new Set(),
  favoriteOrder: [],
  playlists: [],
}));

export const MAX_PLAYLIST_NAME = 60;
const MAX_PLAYLIST_TRACKS = 10_000;

export function hydrateCollections(favorites: { trackId: string; addedAt: number }[], playlists: Playlist[]) {
  const order = favorites.map((f) => f.trackId);
  useCollections.setState({ favorites: new Set(order), favoriteOrder: order, playlists });
}

export function isFavorite(id: string): boolean {
  return useCollections.getState().favorites.has(id);
}

export function setFavorite(id: string, on: boolean): boolean {
  const { favorites, favoriteOrder } = useCollections.getState();
  if (favorites.has(id) === on) return on;
  if (!persist(() => setFavoriteRow(id, on, Date.now()))) return !on;
  const next = new Set(favorites);
  if (on) next.add(id);
  else next.delete(id);
  useCollections.setState({
    favorites: next,
    favoriteOrder: on ? [id, ...favoriteOrder] : favoriteOrder.filter((x) => x !== id),
  });
  return on;
}

export function toggleFavorite(id: string): boolean {
  return setFavorite(id, !isFavorite(id));
}

const cleanName = (name: string) => name.trim().replace(/\s+/g, ' ').slice(0, MAX_PLAYLIST_NAME);

function write(next: Playlist, list: (prev: Playlist[]) => Playlist[]): boolean {
  if (!persist(() => savePlaylist(next))) return false;
  useCollections.setState((s) => ({ playlists: list(s.playlists) }));
  return true;
}

export function playlistById(id: string): Playlist | undefined {
  return useCollections.getState().playlists.find((p) => p.id === id);
}

export function createPlaylist(name: string, trackIds: string[] = []): Playlist | null {
  const clean = cleanName(name);
  if (!clean) return null;
  const now = Date.now();
  const p: Playlist = { id: newId('p'), name: clean, trackIds: trackIds.slice(0, MAX_PLAYLIST_TRACKS), createdAt: now, updatedAt: now };
  return write(p, (prev) => [p, ...prev]) ? p : null;
}

function update(id: string, change: (p: Playlist) => Playlist | null): Playlist | null {
  const prev = playlistById(id);
  if (!prev) return null;
  const changed = change(prev);
  if (!changed) return null;
  const next = { ...changed, updatedAt: Date.now() };
  return write(next, (list) => [next, ...list.filter((p) => p.id !== id)]) ? next : null;
}

export function renamePlaylist(id: string, name: string): boolean {
  const clean = cleanName(name);
  if (!clean) return false;
  return !!update(id, (p) => (p.name === clean ? null : { ...p, name: clean }));
}

/** Adds tracks that aren't in the playlist yet; returns how many were added. */
export function addToPlaylist(id: string, trackIds: string[]): number {
  let added = 0;
  update(id, (p) => {
    const have = new Set(p.trackIds);
    const fresh: string[] = [];
    for (const t of trackIds) {
      if (!have.has(t)) {
        have.add(t);
        fresh.push(t);
      }
    }
    const room = Math.max(0, MAX_PLAYLIST_TRACKS - p.trackIds.length);
    const take = fresh.slice(0, room);
    added = take.length;
    return added ? { ...p, trackIds: [...p.trackIds, ...take] } : null;
  });
  return added;
}

export function removeFromPlaylist(id: string, index: number): boolean {
  return !!update(id, (p) => {
    if (index < 0 || index >= p.trackIds.length) return null;
    const trackIds = p.trackIds.slice();
    trackIds.splice(index, 1);
    return { ...p, trackIds };
  });
}

export function moveInPlaylist(id: string, from: number, to: number): boolean {
  return !!update(id, (p) => {
    const n = p.trackIds.length;
    if (from === to || from < 0 || to < 0 || from >= n || to >= n) return null;
    const trackIds = p.trackIds.slice();
    const [moved] = trackIds.splice(from, 1);
    trackIds.splice(to, 0, moved);
    return { ...p, trackIds };
  });
}

export function setPlaylistTracks(id: string, trackIds: string[]): boolean {
  return !!update(id, (p) => ({ ...p, trackIds: trackIds.slice(0, MAX_PLAYLIST_TRACKS) }));
}

/** Deletes a playlist and returns it so the caller can offer undo. */
export function deletePlaylist(id: string): Playlist | null {
  const prev = playlistById(id);
  if (!prev) return null;
  if (!persist(() => deletePlaylistRow(id))) return null;
  useCollections.setState((s) => ({ playlists: s.playlists.filter((p) => p.id !== id) }));
  return prev;
}

export function restorePlaylist(p: Playlist): boolean {
  if (playlistById(p.id)) return false;
  return write(p, (list) => [p, ...list].sort((a, b) => b.updatedAt - a.updatedAt));
}
