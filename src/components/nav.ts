import { router, type Href } from 'expo-router';

import { closePlayer } from './layout';
import type { PlaySource } from '@/stores/player';
import { closeSheet, useUi } from '@/stores/ui';

/**
 * Navigates from anywhere (a sheet, Now Playing) by first getting the overlays out of the way.
 * `navigate` reuses an existing screen (tabs) instead of stacking a new one.
 */
export function go(href: Href, mode: 'push' | 'navigate' = 'push') {
  closeSheet();
  if (useUi.getState().playerOpen) closePlayer();
  if (mode === 'navigate') router.navigate(href);
  else router.push(href);
}

/** Folder ids are paths, and the storage root's is '' — which can't be a URL segment. */
const ROOT_FOLDER_PARAM = '~';

export function folderHref(folderId: string): Href {
  return { pathname: '/folder/[id]', params: { id: folderId || ROOT_FOLDER_PARAM } };
}

/** The folder id behind a /folder/<param> route. */
export function folderIdFromParam(param: string): string {
  return param === ROOT_FOLDER_PARAM ? '' : param;
}

/** A spoken vibe ("chill late night bass") as a full-page mix. */
export function vibeHref(query: string): Href {
  return { pathname: '/mix/[id]', params: { id: `vibe-${query}` } };
}

/** Opens the Vibe tab with the keyboard up. */
export function openSearch() {
  useUi.setState((s) => ({ searchFocus: s.searchFocus + 1 }));
  go('/vibe', 'navigate');
}

/** Where "Playing from …" leads; null for sources without a screen (search results, the queue). */
export function sourceHref(source: PlaySource | null): Href | null {
  if (!source) return null;
  const id = source.id;
  switch (source.kind) {
    case 'album':
      return id ? { pathname: '/album/[id]', params: { id } } : null;
    case 'artist':
      return id ? { pathname: '/artist/[id]', params: { id } } : null;
    case 'playlist':
      return id ? { pathname: '/playlist/[id]', params: { id } } : null;
    case 'favorites':
      return { pathname: '/playlist/[id]', params: { id: 'favorites' } };
    case 'genre':
      return id ? { pathname: '/genre/[id]', params: { id } } : null;
    case 'folder':
      return id !== undefined ? folderHref(id) : null;
    case 'mood':
      return id ? { pathname: '/mix/[id]', params: { id: `mood-${id}` } } : null;
    case 'daylist':
      return { pathname: '/mix/[id]', params: { id: 'daylist' } };
    case 'similar':
      return id ? { pathname: '/mix/[id]', params: { id: `similar-${id}` } } : null;
    case 'mix':
      return id ? { pathname: '/mix/[id]', params: { id } } : null;
    case 'vibe':
      return id ? vibeHref(id) : null;
    default:
      return null;
  }
}
