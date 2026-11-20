import { FlashList } from '@shopify/flash-list';
import { LinearGradient } from 'expo-linear-gradient';
import { useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, interpolate, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackButton } from './back-button';
import { Button, IconButton } from './buttons';
import { Cover, MosaicCover } from './cover';
import { EmptyState } from './empty-state';
import { SectionHeader, TopBar, useHeaderMetrics, useScrollY } from './header';
import { Icon, type IconName } from './icon';
import { openPlayer, useBottomChrome } from './layout';
import { AlbumTile, TrackRow } from './rows';
import { coverTiles } from './shelf';
import { T } from './text';
import { useArtwork } from '@/audio/artwork';
import { ambientFrom, isDark, mix, withAlpha } from '@/lib/color';
import type { Album, Track } from '@/lib/types';
import { useLibrary } from '@/stores/library';
import { paletteFromCover } from '@/stores/now';
import { player, usePlayer, type PlaySource } from '@/stores/player';
import type { SheetState } from '@/stores/ui';
import { radius, space, useBase } from '@/theme';

export type HeroArt =
  | { kind: 'cover'; albumId: string; trackId: string; label: string; round?: boolean; seed?: string }
  | { kind: 'mosaic'; trackIds: readonly string[]; seed: string; label: string }
  | { kind: 'gradient'; colors: readonly [string, string]; icon: IconName };

type TrackMenu = Omit<Extract<SheetState, { kind: 'track' }>, 'kind' | 'trackId'>;

export type DetailItem =
  | { type: 'track'; key: string; track: Track; index: number; number?: number | null; subtitle?: string; menu?: TrackMenu }
  | { type: 'heading'; key: string; title: string; kicker?: string; action?: { label: string; onPress: () => void } }
  | { type: 'albums'; key: string; albums: Album[] }
  | { type: 'note'; key: string; text: string }
  | { type: 'empty'; key: string; icon: IconName; title: string; body?: string; action?: { label: string; onPress: () => void; icon?: IconName } };

/** Rows for a plain track list; `index` is the position in the list's play order. */
export function trackItems(tracks: readonly Track[], extra?: (t: Track, i: number) => Partial<Extract<DetailItem, { type: 'track' }>>): DetailItem[] {
  return tracks.map((t, i) => ({ type: 'track', key: `t:${t.id}:${i}`, track: t, index: i, ...extra?.(t, i) }));
}

function sameSource(a: PlaySource | null, b: PlaySource): boolean {
  return !!a && a.kind === b.kind && (a.id ?? null) === (b.id ?? null);
}

type DetailScreenProps = {
  kicker: string;
  title: string;
  subtitle?: string;
  onSubtitlePress?: () => void;
  meta?: string;
  art: HeroArt;
  /** The tracks in play order; track items index into this. */
  playIds: string[];
  source: PlaySource;
  items: DetailItem[];
  onMore?: () => void;
  /** Hero content under the play buttons. */
  extra?: ReactNode;
  testID?: string;
};

/** Album, artist, playlist and mix screens: artwork-tinted hero, Play/Shuffle, and a virtualized list. */
export function DetailScreen({ kicker, title, subtitle, onSubtitlePress, meta, art, playIds, source, items, onMore, extra, testID }: DetailScreenProps) {
  const c = useBase();
  const { width } = useWindowDimensions();
  const metrics = useHeaderMetrics();
  const { ref, y } = useScrollY();
  const bottom = useBottomChrome(false);
  const lib = useLibrary((s) => s.lib);
  const artSize = Math.round(Math.min(width * 0.62, 260));
  const [collapseAt, setCollapseAt] = useState(artSize + 60);

  // Tint the page with the artwork's colours (or the generated cover's while there's no art).
  const first = art.kind === 'mosaic' ? coverTiles(lib, art.trackIds, 1)[0] : undefined;
  const artwork = useArtwork(
    art.kind === 'cover' ? art.albumId : (first?.albumId ?? null),
    art.kind === 'cover' ? art.trackId : (first?.trackId ?? null),
    art.kind === 'cover' ? 'lg' : 'sm',
  );
  const ambient =
    art.kind === 'gradient'
      ? ambientFrom(null, art.colors[0])
      : artwork === undefined && (art.kind === 'cover' || first)
        ? ambientFrom(null, '#27272A')
        : ambientFrom(
            artwork?.palette ??
              (art.kind === 'cover'
                ? paletteFromCover(art.seed ?? art.albumId, art.label)
                : paletteFromCover(first?.albumId ?? art.seed, first?.label ?? art.label)),
            '#27272A',
          );

  const onPlay = (i: number) => {
    const s = usePlayer.getState();
    if (sameSource(s.source, source) && s.trackId === playIds[i]) {
      openPlayer();
      return;
    }
    player.playIds(playIds, i, { source });
  };

  const renderItem = ({ item }: { item: DetailItem }) => {
    switch (item.type) {
      case 'track':
        return (
          <TrackRow
            track={item.track}
            index={item.index}
            onPlay={onPlay}
            number={item.number}
            subtitle={item.subtitle}
            menu={item.menu}
            testID={`row-${item.index}`}
          />
        );
      case 'heading':
        return <SectionHeader title={item.title} kicker={item.kicker} action={item.action} />;
      case 'albums':
        return (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.albums}>
            {item.albums.map((a) => (
              <AlbumTile key={a.id} album={a} size={148} subtitle={a.year ? String(a.year) : undefined} />
            ))}
          </ScrollView>
        );
      case 'note':
        return (
          <T variant="small" color="ink4" style={styles.note}>
            {item.text}
          </T>
        );
      case 'empty':
        return <EmptyState compact icon={item.icon} title={item.title} body={item.body} action={item.action} />;
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]} testID={testID}>
      <FlashList
        ref={ref}
        data={items}
        keyExtractor={(item) => item.key}
        getItemType={(item) => item.type}
        renderItem={renderItem}
        drawDistance={600}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <Hero
            y={y}
            art={art}
            artSize={artSize}
            ambient={ambient}
            top={metrics.bar}
            kicker={kicker}
            title={title}
            subtitle={subtitle}
            onSubtitlePress={onSubtitlePress}
            meta={meta}
            playIds={playIds}
            source={source}
            extra={extra}
            onTitleY={(titleY) => setCollapseAt(Math.max(40, Math.round(titleY + 44 - metrics.bar)))}
          />
        }
        ListFooterComponent={<View style={{ height: bottom }} />}
      />
      <TopBar
        y={y}
        title={title}
        collapseAt={collapseAt}
        color={mix(ambient.mid, c.bg, 0.55)}
        left={<BackButton onArt />}
        right={
          onMore ? (
            <IconButton icon="dots-three-vertical" label="More options" onPress={onMore} weight="bold" style={styles.disc} testID="detail-more" />
          ) : null
        }
      />
    </View>
  );
}

type HeroProps = {
  y: SharedValue<number>;
  art: HeroArt;
  artSize: number;
  ambient: { top: string; mid: string };
  top: number;
  kicker: string;
  title: string;
  subtitle?: string;
  onSubtitlePress?: () => void;
  meta?: string;
  playIds: string[];
  source: PlaySource;
  extra?: ReactNode;
  onTitleY: (y: number) => void;
};

function Hero({ y, art, artSize, ambient, top, kicker, title, subtitle, onSubtitlePress, meta, playIds, source, extra, onTitleY }: HeroProps) {
  const c = useBase();
  const current = usePlayer((s) => s.ids.length > 0 && sameSource(s.source, source));
  const playing = usePlayer((s) => s.playWhenReady && s.status !== 'ended');
  const empty = playIds.length === 0;

  const artStyle = useAnimatedStyle(() => {
    const v = Math.max(0, y.get());
    return {
      opacity: interpolate(v, [0, artSize * 0.95], [1, 0], 'clamp'),
      transform: [{ translateY: v * 0.42 }, { scale: interpolate(v, [0, artSize], [1, 0.86], 'clamp') }],
    };
  });

  return (
    <View style={[styles.hero, { paddingTop: top + space.sm }]}>
      <Animated.View key={ambient.top} entering={FadeIn.duration(280)} style={styles.tint} pointerEvents="none">
        <LinearGradient colors={[ambient.top, ambient.mid, c.bg]} locations={[0, 0.58, 1]} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <Animated.View style={[styles.art, artStyle]}>
        <HeroArtView art={art} size={artSize} />
      </Animated.View>
      <View style={styles.heroText} onLayout={(e) => onTitleY(e.nativeEvent.layout.y)}>
        <T variant="label" color="ink3" align="center" numberOfLines={1}>
          {kicker}
        </T>
        <T variant="display" align="center" numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.66} accessibilityRole="header">
          {title}
        </T>
        {subtitle ? (
          <T
            variant="calloutMedium"
            color="ink2"
            align="center"
            numberOfLines={1}
            onPress={onSubtitlePress}
            suppressHighlighting
            accessibilityRole={onSubtitlePress ? 'link' : undefined}
            style={styles.subtitle}>
            {subtitle}
          </T>
        ) : null}
        {meta ? (
          <T variant="small" color="ink3" align="center" numberOfLines={1}>
            {meta}
          </T>
        ) : null}
      </View>
      <View style={styles.actions}>
        <Button
          label={current ? (playing ? 'Pause' : 'Resume') : 'Play'}
          icon={current && playing ? 'pause' : 'play'}
          size="lg"
          grow
          disabled={empty}
          onPress={() => (current ? player.toggle() : player.playIds(playIds, 0, { source }))}
          testID="detail-play"
        />
        <Button
          label="Shuffle"
          icon="shuffle"
          variant="secondary"
          size="lg"
          grow
          disabled={playIds.length < 2}
          onPress={() => player.playIds(playIds, -1, { shuffle: true, source })}
          testID="detail-shuffle"
        />
      </View>
      {extra}
    </View>
  );
}

function HeroArtView({ art, size }: { art: HeroArt; size: number }) {
  const lib = useLibrary((s) => s.lib);
  const shadow = styles.shadow;
  switch (art.kind) {
    case 'cover':
      return (
        <Cover
          albumId={art.albumId}
          trackId={art.trackId}
          label={art.label}
          seed={art.seed}
          size={size}
          rounded={art.round ? size / 2 : radius.md}
          art="lg"
          style={shadow}
        />
      );
    case 'mosaic':
      return <MosaicCover tiles={coverTiles(lib, art.trackIds)} seed={art.seed} label={art.label} size={size} rounded={radius.md} style={shadow} />;
    case 'gradient': {
      const ink = isDark(mix(art.colors[0], art.colors[1], 0.5)) ? '#FAFAFA' : '#0B0B0D';
      return (
        <View style={[styles.gradientArt, { width: size, height: size }, shadow]}>
          <LinearGradient colors={art.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <Icon name={art.icon} size={Math.round(size * 0.4)} color={withAlpha(ink, 0.92)} weight="fill" />
        </View>
      );
    }
  }
}

/** For a detail route whose item disappeared (deleted file, stale link). */
export function MissingScreen({ title, body }: { title: string; body: string }) {
  const c = useBase();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { backgroundColor: c.bg, paddingTop: insets.top }]}>
      <View style={styles.missingBar}>
        <BackButton />
      </View>
      <EmptyState icon="music-notes-simple" title={title} body={body} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  hero: { alignItems: 'center', paddingBottom: space.lg },
  tint: { ...StyleSheet.absoluteFill, bottom: -1 },
  art: { marginBottom: space.xl },
  shadow: { boxShadow: '0 22px 48px rgba(0,0,0,0.5)' },
  gradientArt: { borderRadius: radius.md, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  heroText: { alignItems: 'center', gap: 6, paddingHorizontal: space.xxl, alignSelf: 'stretch' },
  subtitle: { paddingVertical: 2 },
  actions: { flexDirection: 'row', gap: space.md, paddingHorizontal: space.page, marginTop: space.xl, alignSelf: 'stretch' },
  albums: { paddingHorizontal: space.page, gap: space.md, paddingBottom: space.sm },
  note: { paddingHorizontal: space.page, paddingTop: space.lg },
  disc: { backgroundColor: 'rgba(0,0,0,0.22)' },
  missingBar: { height: 56, justifyContent: 'center', paddingHorizontal: space.xs },
});
