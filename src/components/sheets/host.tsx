import { useState, type ReactNode } from 'react';

import { SheetFrame } from '../sheet';
import { QueueSheet } from '../player/queue';
import { TrackInfoSheet } from './info';
import { AlbumSheet, PlaylistSheet, TrackSheet } from './menus';
import { AddToPlaylistSheet, NewPlaylistSheet, RenamePlaylistSheet } from './playlists';
import { SortSheet } from './sort';
import { SleepSheet, SpeedSheet } from './timers';
import { closeSheet, useUi, type SheetState } from '@/stores/ui';

function content(sheet: SheetState): { body: ReactNode; drag?: 'panel' | 'handle'; fill?: number } {
  switch (sheet.kind) {
    case 'track':
      return { body: <TrackSheet {...sheet} /> };
    case 'album':
      return { body: <AlbumSheet albumId={sheet.albumId} /> };
    case 'playlist':
      return { body: <PlaylistSheet playlistId={sheet.playlistId} /> };
    case 'add-to-playlist':
      return { body: <AddToPlaylistSheet trackIds={sheet.trackIds} />, drag: 'handle' };
    case 'new-playlist':
      return { body: <NewPlaylistSheet trackIds={sheet.trackIds} /> };
    case 'rename-playlist':
      return { body: <RenamePlaylistSheet playlistId={sheet.playlistId} /> };
    case 'queue':
      return { body: <QueueSheet />, drag: 'handle', fill: 0.88 };
    case 'sleep':
      return { body: <SleepSheet /> };
    case 'speed':
      return { body: <SpeedSheet /> };
    case 'track-info':
      return { body: <TrackInfoSheet trackId={sheet.trackId} />, drag: 'handle', fill: 0.82 };
    case 'sort':
      return { body: <SortSheet /> };
  }
}

/**
 * Renders the sheet in `useUi`. The last sheet stays mounted while it animates out, and opening a
 * sheet from another one swaps it in place.
 */
export function SheetHost() {
  const sheet = useUi((s) => s.sheet);
  const sheetKey = useUi((s) => s.sheetKey);
  const [shown, setShown] = useState<{ sheet: SheetState; key: number } | null>(null);

  if (sheet && shown?.key !== sheetKey) setShown({ sheet, key: sheetKey });
  if (!shown) return null;

  const visible = sheet !== null && shown.key === sheetKey;
  const { body, drag, fill } = content(shown.sheet);
  const closedKey = shown.key;
  return (
    <SheetFrame
      key={shown.key}
      visible={visible}
      onClose={closeSheet}
      onClosed={() => setShown((s) => (s?.key === closedKey && !useUi.getState().sheet ? null : s))}
      drag={drag}
      fill={fill}
      testID={`sheet-${shown.sheet.kind}`}>
      {body}
    </SheetFrame>
  );
}
