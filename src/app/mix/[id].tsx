import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { DetailScreen, MissingScreen, trackItems, type DetailItem } from '@/components/collection';
import { useMix } from '@/hooks/use-mix';
import { formatTotalDuration } from '@/lib/format';
import type { Track } from '@/lib/types';
import { useLibrary } from '@/stores/library';

export default function MixScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const mix = useMix(id ?? '');
  const byId = useLibrary((s) => s.lib.byId);

  const view = useMemo(() => {
    if (!mix) return null;
    const tracks = mix.trackIds.map((t) => byId.get(t)).filter((t): t is Track => !!t);
    const ms = tracks.reduce((sum, t) => sum + t.durationMs, 0);
    const items: DetailItem[] = tracks.length
      ? trackItems(tracks)
      : [{ type: 'empty', key: 'e:mix', icon: 'sparkle', title: 'Nothing here yet', body: mix.emptyHint }];
    if (tracks.length && mix.id === 'daylist') {
      items.push({ type: 'note', key: 'n:daylist', text: 'Your daylist changes with the time of day, and with what you play.' });
    }
    return { ms, items, playIds: tracks.map((t) => t.id) };
  }, [mix, byId]);

  if (!mix || !view) {
    return <MissingScreen title="This mix isn't available" body="The song it was built around may have been moved or deleted." />;
  }
  return (
    <DetailScreen
      kicker={mix.kicker}
      title={mix.title}
      subtitle={mix.subtitle}
      meta={view.playIds.length ? formatTotalDuration(view.ms) : undefined}
      art={mix.art}
      playIds={view.playIds}
      source={mix.source}
      items={view.items}
      testID="mix"
    />
  );
}
