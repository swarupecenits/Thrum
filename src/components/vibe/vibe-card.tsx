import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { IconButton } from '../buttons';
import { Cover } from '../cover';
import { Icon } from '../icon';
import { go, vibeHref } from '../nav';
import { Press, surfaceRole } from '../press';
import { coverTiles, useFanTitleFit } from '../shelf';
import { T } from '../text';
import { vibeColors, vibeIcon } from '@/hooks/use-mix';
import { mix } from '@/lib/color';
import { formatCount } from '@/lib/format';
import { primaryArtist } from '@/lib/library';
import type { Library, VibeQuery } from '@/lib/types';
import { describeVibe, vibeTitle } from '@/lib/vibe';
import { createPlaylist, MAX_PLAYLIST_NAME } from '@/stores/collections';
import { player, usePlayer, type PlaySource } from '@/stores/player';
import { toast } from '@/stores/toast';
import { radius, space } from '@/theme';

const ART = 92;
const FAN_W = ART + 36;
/** The card's row besides the title: page margins, card padding, the gap and the fan. */
const CHROME = 2 * space.page + 2 * space.lg + space.xxl + FAN_W;
const FAN = [
  { rotate: '-9deg', x: -38, y: 10, z: 1 },
  { rotate: '7deg', x: 30, y: 4, z: 2 },
  { rotate: '-1deg', x: -4, y: -6, z: 3 },
] as const;
const INK = 'rgba(255,255,255,0.8)';

/** "Prateek Kuhad, Anuv Jain and 12 more": who the vibe mostly is. */
function leadArtists(lib: Library, ids: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const id of ids.slice(0, 60)) {
    const t = lib.byId.get(id);
    if (!t) continue;
    const a = primaryArtist(t);
    counts.set(a, (counts.get(a) ?? 0) + 1);
  }
  const names = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([n]) => n);
  const shown = names.slice(0, 2).join(', ');
  return names.length > 2 ? `${shown} and ${names.length - 2} more` : shown;
}

type VibeCardProps = {
  /** The words as typed (trimmed); also the vibe's id, so the card and its mix page share a queue. */
  query: string;
  vibe: VibeQuery;
  ids: string[];
  lib: Library;
  /** Called when this card starts playback, so the search can be remembered. */
  onPlay?: () => void;
};

/** A spoken vibe as a playable card: tap for the full mix, or play, shuffle or keep it as a playlist. */
export function VibeCard({ query, vibe, ids, lib, onPlay }: VibeCardProps) {
  const here = usePlayer((s) => s.source?.kind === 'vibe' && s.source.id === query);
  const playing = usePlayer((s) => s.playWhenReady && s.source?.kind === 'vibe' && s.source.id === query);
  const [saved, setSaved] = useState<{ query: string; playlistId: string } | null>(null);
  const savedId = saved?.query === query ? saved.playlistId : null;
  const fit = useFanTitleFit(CHROME);

  const title = describeVibe(vibe);
  const [c1, c2] = vibeColors(vibe);
  const colors = [mix(c1, '#09090B', 0.3), mix(c2, '#09090B', 0.5), '#0E0E11'] as const;
  const tiles = coverTiles(lib, ids, 3);
  const source: PlaySource = { kind: 'vibe', id: query, label: title };

  const play = () => {
    if (here) {
      player.toggle();
      return;
    }
    if (player.playIds(ids, 0, { source })) onPlay?.();
  };
  const shuffle = () => {
    if (player.playIds(ids, -1, { shuffle: true, source })) onPlay?.();
  };
  const openPlaylist = (id: string) => go({ pathname: '/playlist/[id]', params: { id } });
  const save = () => {
    if (savedId) {
      openPlaylist(savedId);
      return;
    }
    const p = createPlaylist(title.slice(0, MAX_PLAYLIST_NAME), ids);
    if (!p) {
      toast({ message: "Couldn't save this vibe. Try again.", tone: 'danger', icon: 'warning' });
      return;
    }
    setSaved({ query, playlistId: p.id });
    toast({
      message: `Saved as a playlist with ${formatCount(p.trackIds.length, 'song')}`,
      tone: 'success',
      icon: 'check',
      action: { label: 'Open', onPress: () => openPlaylist(p.id) },
    });
  };

  return (
    <Press
      onPress={() => go(vibeHref(query))}
      scale={0.985}
      accessibilityRole="button"
      role={surfaceRole}
      accessibilityLabel={`Vibe: ${title}. ${formatCount(ids.length, 'song')}. Opens the full mix.`}
      style={styles.wrap}
      testID="vibe-card">
      <LinearGradient colors={colors} locations={[0, 0.62, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
        <View style={styles.kicker}>
          <Icon name={vibeIcon(vibe)} size={14} color={INK} weight="bold" />
          <T variant="label" color={INK}>
            {`Vibe \u00b7 ${formatCount(ids.length, 'song')}`}
          </T>
        </View>
        <View style={styles.body}>
          <T variant="serifItalic" color="#FFFFFF" numberOfLines={4} style={[styles.title, fit]}>
            {vibeTitle(vibe)}
          </T>
          <View style={styles.fan} pointerEvents="none">
            {tiles.map((t, i) => {
              const f = FAN[FAN.length - tiles.length + i];
              return (
                <Cover
                  key={t.albumId}
                  albumId={t.albumId}
                  trackId={t.trackId}
                  label={t.label}
                  size={ART}
                  rounded={radius.sm}
                  style={[styles.tile, { zIndex: f.z, transform: [{ translateX: f.x }, { translateY: f.y }, { rotate: f.rotate }] }]}
                />
              );
            })}
          </View>
        </View>
        <View style={styles.footer}>
          <T variant="small" color="rgba(255,255,255,0.72)" numberOfLines={2} style={styles.subtitle}>
            {leadArtists(lib, ids)}
          </T>
          <IconButton
            icon={savedId ? 'check' : 'list-plus'}
            label={savedId ? 'Saved. Open the playlist' : 'Save as a playlist'}
            color="#FFFFFF"
            weight="bold"
            onPress={save}
            testID="vibe-save"
          />
          <IconButton icon="shuffle" label="Shuffle this vibe" color="#FFFFFF" weight="bold" onPress={shuffle} testID="vibe-shuffle" />
          <IconButton
            icon={playing ? 'pause' : 'play'}
            label={playing ? 'Pause this vibe' : 'Play this vibe'}
            tone="accent"
            size={48}
            onPress={play}
            testID="vibe-play"
          />
        </View>
      </LinearGradient>
    </Press>
  );
}

const styles = StyleSheet.create({
  wrap: { marginHorizontal: space.page },
  card: {
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.md,
    minHeight: 216,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  kicker: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  // The back cover's corner reaches ~26 px left of the fan; the wide gap keeps the title out from under it.
  body: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: space.xxl },
  title: { flex: 1 },
  fan: { width: FAN_W, height: ART + 20, alignItems: 'center', justifyContent: 'center' },
  tile: { position: 'absolute', boxShadow: '0 10px 24px rgba(0,0,0,0.45)' },
  footer: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  subtitle: { flex: 1, marginRight: space.xs },
});
