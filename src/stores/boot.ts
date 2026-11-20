import type { Db } from '@/db/adapter';
import { setDb } from '@/db/adapter';
import {
  loadFavorites,
  loadFeatures,
  loadLibraryCache,
  loadPlaylists,
  loadPlays,
  loadSearches,
  loadSettingsRows,
} from '@/db/repos';
import { migrate } from '@/db/schema';
import { setHapticsEnabled } from '@/utils/haptics';
import { hydrateCollections } from './collections';
import { hydrateFeatures } from './features';
import { hydrateHistory } from './history';
import { hydrateLibrary } from './library';
import { hydratePlayerMeta } from './player';
import { useSearches } from './searches';
import { readSettings, useSettings } from './settings';

/** Opens storage and loads everything into memory; afterwards the stores only write. */
export async function boot(database: Db) {
  setDb(database);
  await migrate(database);
  const [rows, plays, favorites, playlists, features, cache, searches] = await Promise.all([
    loadSettingsRows(),
    loadPlays(),
    loadFavorites(),
    loadPlaylists(),
    loadFeatures(),
    loadLibraryCache(),
    loadSearches(),
  ]);
  const settings = readSettings(rows);
  useSettings.setState(settings);
  setHapticsEnabled(settings.haptics);
  hydrateHistory(plays);
  hydrateCollections(favorites, playlists);
  hydrateFeatures(features);
  hydrateLibrary(cache);
  useSearches.setState({ recent: searches });
  hydratePlayerMeta(rows['q.meta']);
}
