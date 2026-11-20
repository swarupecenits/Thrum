import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { DetailScreen, MissingScreen, trackItems } from '@/components/collection';
import { folderIdFromParam } from '@/components/nav';
import { formatCount, formatTotalDuration } from '@/lib/format';
import { folderTracks } from '@/lib/library';
import { compareText } from '@/lib/text';
import type { Library } from '@/lib/types';
import { useLibrary } from '@/stores/library';

function findFolder(lib: Library, param: string) {
  const id = folderIdFromParam(param);
  const found = lib.folders.find((f) => f.id === id);
  if (found) return found;
  // Folder ids are paths; if a platform hands the param over still percent-encoded, decode it once.
  try {
    const decoded = decodeURIComponent(id);
    return decoded === id ? undefined : lib.folders.find((f) => f.id === decoded);
  } catch {
    return undefined;
  }
}

export default function FolderScreen() {
  const { id: param } = useLocalSearchParams<{ id: string }>();
  const lib = useLibrary((s) => s.lib);
  const folder = findFolder(lib, param ?? '');

  const view = useMemo(() => {
    if (!folder) return null;
    // File order, the way a file manager shows the folder.
    const tracks = folderTracks(lib, folder.id).sort((a, b) => compareText(a.fileName, b.fileName));
    const ms = tracks.reduce((sum, t) => sum + t.durationMs, 0);
    return { tracks, ms, playIds: tracks.map((t) => t.id), items: trackItems(tracks) };
  }, [folder, lib]);

  if (!folder || !view) {
    return <MissingScreen title="This folder has no music now" body="Its songs may have been moved or deleted, or the folder is hidden in Settings." />;
  }
  const path = folder.id ? `/${folder.id.replace(/\/+$/, '')}` : undefined;
  return (
    <DetailScreen
      kicker="Folder"
      title={folder.name}
      subtitle={path}
      meta={`${formatCount(view.tracks.length, 'song')} \u00b7 ${formatTotalDuration(view.ms)}`}
      art={{ kind: 'mosaic', trackIds: view.playIds, seed: `folder-${folder.id}`, label: folder.name }}
      playIds={view.playIds}
      source={{ kind: 'folder', id: folder.id, label: folder.name }}
      items={view.items}
      testID="folder"
    />
  );
}
