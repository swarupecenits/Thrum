import { create } from 'zustand';

import { saveSearch, clearSearches as clearSearchRows } from '@/db/repos';
import { buildSearchIndex, type SearchIndex } from '@/lib/search';
import type { Library, Playlist } from '@/lib/types';
import { persist } from './persist';
import { useCollections } from './collections';
import { useLibrary } from './library';

type SearchesState = { recent: string[] };

export const useSearches = create<SearchesState>()(() => ({ recent: [] }));

export function rememberSearch(query: string) {
  const q = query.trim().replace(/\s+/g, ' ');
  if (q.length < 2 || q.length > 80) return;
  const recent = [q, ...useSearches.getState().recent.filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, 12);
  useSearches.setState({ recent });
  persist(() => saveSearch(q, Date.now()));
}

export function clearSearches() {
  useSearches.setState({ recent: [] });
  persist(clearSearchRows);
}

let memo: { lib: Library; playlists: Playlist[]; index: SearchIndex } | null = null;

/** The text index is rebuilt lazily, only after the library or playlists actually change. */
function indexFor(lib: Library, playlists: Playlist[]): SearchIndex {
  if (!memo || memo.lib !== lib || memo.playlists !== playlists) {
    memo = { lib, playlists, index: buildSearchIndex(lib, playlists) };
  }
  return memo.index;
}

export function useSearchIndex(): SearchIndex {
  const lib = useLibrary((s) => s.lib);
  const playlists = useCollections((s) => s.playlists);
  return indexFor(lib, playlists);
}
