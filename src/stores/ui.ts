import { create } from 'zustand';

export type SheetState =
  | { kind: 'track'; trackId: string; playlistId?: string; playlistIndex?: number; queueIndex?: number }
  | { kind: 'album'; albumId: string }
  | { kind: 'add-to-playlist'; trackIds: string[] }
  | { kind: 'new-playlist'; trackIds: string[] }
  | { kind: 'rename-playlist'; playlistId: string }
  | { kind: 'playlist'; playlistId: string }
  | { kind: 'queue' }
  | { kind: 'sleep' }
  | { kind: 'speed' }
  | { kind: 'track-info'; trackId: string }
  | { kind: 'sort' };

export type NowView = 'art' | 'lyrics';

type UiState = {
  sheet: SheetState | null;
  /** Bumped on every open so re-opening the same sheet restarts its animation. */
  sheetKey: number;
  playerOpen: boolean;
  nowView: NowView;
  /** Bumped when another screen sends the user to search, so the Vibe tab puts the keyboard up. */
  searchFocus: number;
};

export const useUi = create<UiState>()(() => ({ sheet: null, sheetKey: 0, playerOpen: false, nowView: 'art', searchFocus: 0 }));

export function openSheet(sheet: SheetState) {
  useUi.setState((s) => ({ sheet, sheetKey: s.sheetKey + 1 }));
}

export function closeSheet() {
  if (useUi.getState().sheet) useUi.setState({ sheet: null });
}

export function setNowView(nowView: NowView) {
  useUi.setState({ nowView });
}
