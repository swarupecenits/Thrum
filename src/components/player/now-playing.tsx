import { memo, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { GestureDetector, useCompetingGestures, usePanGesture, useTapGesture } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { IconButton } from '../buttons';
import { Icon, type IconName } from '../icon';
import { closePlayer } from '../layout';
import { go, sourceHref } from '../nav';
import { Press } from '../press';
import { T } from '../text';
import { CONTROLS_H, LYRICS_ART, NOW_BAR_H, type NowGeometry } from './geometry';
import { clamp01, useClosePan } from './gestures';
import { Lyrics } from './lyrics';
import { Marquee } from './marquee';
import { SeekBar } from './seek-bar';
import { useTags } from '@/audio/tags';
import { useSecondTicker } from '@/hooks/use-clock';
import { useNowTrack } from '@/hooks/use-library';
import { withAlpha } from '@/lib/color';
import { camelot } from '@/lib/features';
import { formatDuration, qualityLabel } from '@/lib/format';
import { artistIdOf, primaryArtist } from '@/lib/library';
import type { Track } from '@/lib/types';
import { setFavorite, toggleFavorite, useCollections } from '@/stores/collections';
import { useFeatures } from '@/stores/features';
import { currentIndex, player, usePlayer } from '@/stores/player';
import { toast } from '@/stores/toast';
import { openSheet, setNowView, useUi } from '@/stores/ui';
import { springs, useTheme, type Palette } from '@/theme';
import { haptic } from '@/utils/haptics';

type NowPlayingProps = {
  geo: NowGeometry;
  /** Fully open (not just being dragged): gates tickers, marquees and gestures. */
  open: boolean;
  /** 0 = artwork, 1 = lyrics. */
  lyricsP: SharedValue<number>;
  /** Horizontal offset of the flying artwork while it's swiped. */
  artSwipe: SharedValue<number>;
  /** 0..1 heart burst after a double tap on the artwork. */
  burst: SharedValue<number>;
};

/**
 * Everything on the Now Playing panel except the artwork itself, which flies between the mini
 * player, this screen and the lyrics header in the overlay above.
 */
function NowPlayingBase({ geo, open, lyricsP, artSwipe, burst }: NowPlayingProps) {
  const c = useTheme();
  const track = useNowTrack();
  const lyricsOn = useUi((s) => s.nowView === 'lyrics');
  const [lyricsMounted, setLyricsMounted] = useState(lyricsOn);
  if (lyricsOn && !lyricsMounted) setLyricsMounted(true);

  useEffect(() => {
    if (lyricsOn || !lyricsMounted) return;
    // Let the list fade out before it goes.
    const t = setTimeout(() => setLyricsMounted(false), 450);
    return () => clearTimeout(t);
  }, [lyricsOn, lyricsMounted]);

  const topPan = useClosePan(geo, open);
  const controlsPan = useClosePan(geo, open);

  const artMode = useAnimatedStyle(() => {
    const l = lyricsP.get();
    return { opacity: 1 - clamp01(l * 2.5), transform: [{ translateY: l * 14 }] };
  });
  const lyricsMode = useAnimatedStyle(() => {
    const l = lyricsP.get();
    return { opacity: clamp01((l - 0.35) / 0.65), transform: [{ translateY: (1 - l) * 18 }] };
  });

  if (!track) return null;

  const controlsTop = geo.height - geo.controlsBottom;
  const lyricsH = Math.max(120, controlsTop - geo.lyricsTop);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <GestureDetector gesture={topPan}>
        <View style={[styles.zone, { height: lyricsOn ? geo.lyricsTop : controlsTop }]}>
          <TopBar geo={geo} track={track} />
          {lyricsOn ? null : (
            <ArtZone geo={geo} track={track} artSwipe={artSwipe} burst={burst} />
          )}
          <Animated.View
            style={[styles.titleBlock, { top: geo.titleTop }, artMode]}
            pointerEvents={lyricsOn ? 'none' : 'box-none'}>
            <TitleBlock track={track} open={open && !lyricsOn} accent={c.accent} />
          </Animated.View>
          {lyricsMounted ? (
            <Animated.View
              style={[styles.lyricsHeader, { top: geo.lyricsArt.y, left: geo.lyricsArt.x }, lyricsMode]}
              pointerEvents={lyricsOn ? 'box-none' : 'none'}>
              <LyricsHeader track={track} accent={c.accent} />
            </Animated.View>
          ) : null}
        </View>
      </GestureDetector>

      {lyricsMounted ? (
        <Animated.View
          style={[styles.lyrics, { top: geo.lyricsTop, height: lyricsH }, lyricsMode]}
          pointerEvents={lyricsOn ? 'auto' : 'none'}>
          <Lyrics trackId={track.id} top={geo.lyricsTop} height={lyricsH} windowHeight={geo.height} />
        </Animated.View>
      ) : null}

      <GestureDetector gesture={controlsPan}>
        <View style={[styles.controls, { bottom: geo.insetBottom + 12, height: CONTROLS_H }]}>
          <SeekBar active={open} color={c.accent} rest={withAlpha(c.ink, 0.16)} thumb={c.ink} />
          <Transport c={c} />
          <Actions open={open} c={c} />
        </View>
      </GestureDetector>
    </View>
  );
}

export const NowPlaying = memo(NowPlayingBase);

function TopBar({ geo, track }: { geo: NowGeometry; track: Track }) {
  const source = usePlayer((s) => s.source);
  const href = sourceHref(source);
  const label = source?.label || 'Your library';
  return (
    <View style={[styles.topBar, { top: geo.insetTop }]}>
      <IconButton icon="caret-down" label="Close player" iconSize={24} onPress={() => closePlayer()} testID="now-close" />
      <Pressable
        style={styles.source}
        disabled={!href}
        onPress={href ? () => go(href) : undefined}
        accessibilityRole={href ? 'link' : 'text'}
        accessibilityLabel={`Playing from ${label}`}>
        <T variant="label" color="ink3" align="center">
          Playing from
        </T>
        <T variant="caption" align="center" numberOfLines={1}>
          {label}
        </T>
      </Pressable>
      <IconButton
        icon="dots-three"
        label="More options"
        iconSize={24}
        weight="bold"
        onPress={() => openSheet({ kind: 'track', trackId: track.id, queueIndex: currentIndex() })}
        testID="now-more"
      />
    </View>
  );
}

/** Invisible touch target over the big artwork: swipe for next/previous, double tap to like. */
function ArtZone({
  geo,
  track,
  artSwipe,
  burst,
}: {
  geo: NowGeometry;
  track: Track;
  artSwipe: SharedValue<number>;
  burst: SharedValue<number>;
}) {
  const canNext = usePlayer((s) => s.index < s.ids.length - 1 || (s.repeat === 'all' && s.ids.length > 1));
  const W = geo.width;

  const skip = (dir: number) => {
    haptic('select');
    if (dir > 0) player.next();
    else player.previousTrack();
  };
  const like = () => {
    haptic('success');
    setFavorite(track.id, true);
  };

  const pan = usePanGesture({
    activeOffsetX: [-12, 12],
    failOffsetY: [-12, 12],
    onUpdate: (e) => {
      'worklet';
      // Rubber band when there's nothing to swipe to.
      artSwipe.set(e.translationX < 0 && !canNext ? e.translationX * 0.3 : e.translationX);
    },
    onDeactivate: (e) => {
      'worklet';
      const dx = e.translationX;
      const vx = e.velocityX;
      const dir = dx < 0 ? 1 : -1;
      const reversed = Math.abs(vx) > 300 && Math.sign(vx) !== Math.sign(dx);
      const far = Math.abs(dx) > W * 0.22 || Math.abs(vx) > 700;
      if (e.canceled || reversed || !far || (dir > 0 && !canNext)) {
        artSwipe.set(withSpring(0, springs.snappy));
        return;
      }
      scheduleOnRN(skip, dir);
      artSwipe.set(
        withSequence(
          withTiming(-dir * W, { duration: 170, easing: Easing.in(Easing.quad) }),
          withTiming(dir * W * 0.4, { duration: 0 }),
          withSpring(0, springs.gentle),
        ),
      );
    },
  });

  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    maxDelay: 260,
    onActivate: () => {
      'worklet';
      burst.set(0);
      burst.set(withTiming(1, { duration: 820, easing: Easing.out(Easing.cubic) }));
      scheduleOnRN(like);
    },
  });

  const gesture = useCompetingGestures(pan, doubleTap);

  return (
    <GestureDetector gesture={gesture}>
      <View
        style={[styles.artZone, { left: geo.art.x, top: geo.art.y, width: geo.art.size, height: geo.art.size }]}
        accessible
        accessibilityRole="image"
        accessibilityLabel={`Artwork for ${track.album}`}
        testID="now-art"
      />
    </GestureDetector>
  );
}

function LikeButton({ id, accent }: { id: string; accent: string }) {
  const liked = useCollections((s) => s.favorites.has(id));
  return (
    <IconButton
      icon="heart"
      label={liked ? 'Remove from favourites' : 'Add to favourites'}
      selected={liked}
      weight={liked ? 'fill' : 'regular'}
      color={liked ? accent : undefined}
      iconSize={24}
      haptic={liked ? 'tap' : 'success'}
      onPress={() => toggleFavorite(id)}
      testID="now-like"
    />
  );
}

function TitleBlock({ track, open, accent }: { track: Track; open: boolean; accent: string }) {
  const toAlbum = () => go({ pathname: '/album/[id]', params: { id: track.albumId } });
  const toArtist = () => go({ pathname: '/artist/[id]', params: { id: artistIdOf(primaryArtist(track)) } });
  return (
    <>
      <View style={styles.titleRow}>
        <View style={styles.titleText}>
          <Pressable
            onPress={toAlbum}
            accessibilityRole="link"
            accessibilityLabel={track.title}
            accessibilityHint={`Opens ${track.album}`}>
            <Marquee text={track.title} variant="title" active={open} testID="now-title" />
          </Pressable>
          <Pressable
            onPress={toArtist}
            accessibilityRole="link"
            accessibilityLabel={track.artist}
            accessibilityHint="Opens the artist"
            style={styles.artist}>
            <T variant="bodyMedium" color="ink2" numberOfLines={1}>
              {track.artist}
            </T>
          </Pressable>
        </View>
        <LikeButton id={track.id} accent={accent} />
      </View>
      <MetaLine track={track} accent={accent} />
    </>
  );
}

/** "FLAC · 24-bit · 96 kHz · 128 BPM · 8A": the details a bass head actually wants to see. */
function MetaLine({ track, accent }: { track: Track; accent: string }) {
  const tags = useTags(track.id);
  const f = useFeatures((s) => s.map.get(track.id));
  const q = qualityLabel(track, tags);
  const bpm = f && f.bpm > 0 && f.bpmConfidence >= 0.3 ? `${Math.round(f.bpm)} BPM` : '';
  const key = f && f.key >= 0 && f.keyConfidence >= 0.3 ? camelot(f.key, f.mode) : '';
  const text = [q.codec, q.detail, bpm, key].filter(Boolean).join(' · ');
  const badge = q.hiRes ? 'Hi-Res' : q.lossless ? 'Lossless' : null;
  return (
    <View style={styles.meta}>
      {badge ? (
        <View style={[styles.badge, { borderColor: withAlpha(accent, 0.6) }]}>
          <T variant="label" color={accent} style={styles.badgeText}>
            {badge}
          </T>
        </View>
      ) : null}
      <T variant="mono" color="ink3" numberOfLines={1} style={styles.metaText}>
        {text}
      </T>
    </View>
  );
}

function LyricsHeader({ track, accent }: { track: Track; accent: string }) {
  return (
    <>
      <Pressable
        style={styles.lyricsHeaderPress}
        onPress={() => setNowView('art')}
        accessibilityRole="button"
        accessibilityLabel={`${track.title} by ${track.artist}`}
        accessibilityHint="Shows the artwork again">
        {/* The flying artwork lands in this gap. */}
        <View style={styles.lyricsThumbGap} />
        <View style={styles.lyricsHeaderText}>
          <T variant="headline" numberOfLines={1}>
            {track.title}
          </T>
          <T variant="callout" color="ink3" numberOfLines={1}>
            {track.artist}
          </T>
        </View>
      </Pressable>
      <LikeButton id={track.id} accent={accent} />
    </>
  );
}

function PlayButton({ c }: { c: Palette }) {
  const playing = usePlayer((s) => s.playWhenReady);
  const p = useSharedValue(playing ? 1 : 0);

  useEffect(() => {
    p.set(withSpring(playing ? 1 : 0, springs.snappy));
  }, [playing, p]);

  const pauseIcon = useAnimatedStyle(() => {
    const v = clamp01(p.get());
    return { opacity: v, transform: [{ scale: 0.55 + 0.45 * v }, { rotate: `${(1 - v) * -60}deg` }] };
  });
  const playIcon = useAnimatedStyle(() => {
    const v = clamp01(p.get());
    return { opacity: 1 - v, transform: [{ scale: 1 - 0.45 * v }, { rotate: `${v * 60}deg` }] };
  });

  return (
    <Press
      onPress={() => player.toggle()}
      haptic="soft"
      scale={0.9}
      accessibilityLabel={playing ? 'Pause' : 'Play'}
      style={[styles.play, { backgroundColor: c.accent }]}
      testID="now-play">
      <Animated.View style={[styles.playIcon, playIcon]}>
        <Icon name="play" size={30} color={c.onAccent} weight="fill" />
      </Animated.View>
      <Animated.View style={[styles.playIcon, pauseIcon]}>
        <Icon name="pause" size={30} color={c.onAccent} weight="fill" />
      </Animated.View>
    </Press>
  );
}

function ToggleButton({
  icon,
  label,
  on,
  c,
  onPress,
  testID,
}: {
  icon: IconName;
  label: string;
  on: boolean;
  c: Palette;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <View style={styles.toggle}>
      <IconButton
        icon={icon}
        label={label}
        selected={on}
        color={on ? c.accent : c.ink3}
        weight={on ? 'bold' : 'regular'}
        iconSize={22}
        haptic="select"
        onPress={onPress}
        testID={testID}
      />
      <View style={[styles.dot, { backgroundColor: c.accent, opacity: on ? 1 : 0 }]} />
    </View>
  );
}

function Transport({ c }: { c: Palette }) {
  const shuffle = usePlayer((s) => s.original !== null);
  const repeat = usePlayer((s) => s.repeat);
  const repeatLabel = repeat === 'one' ? 'Repeat: this song' : repeat === 'all' ? 'Repeat: queue' : 'Repeat: off';
  return (
    <View style={styles.transport}>
      <ToggleButton
        icon="shuffle"
        label={shuffle ? 'Shuffle on' : 'Shuffle off'}
        on={shuffle}
        c={c}
        onPress={() => player.toggleShuffle()}
        testID="now-shuffle"
      />
      <IconButton
        icon="skip-back"
        label="Previous"
        size={52}
        iconSize={30}
        weight="fill"
        onPress={() => player.previous()}
        onLongPress={() => {
          haptic('tick');
          player.seekBy(-10_000);
        }}
        testID="now-prev"
      />
      <PlayButton c={c} />
      <IconButton
        icon="skip-forward"
        label="Next"
        size={52}
        iconSize={30}
        weight="fill"
        onPress={() => player.next()}
        onLongPress={() => {
          haptic('tick');
          player.seekBy(10_000);
        }}
        testID="now-next"
      />
      <ToggleButton
        icon={repeat === 'one' ? 'repeat-once' : 'repeat'}
        label={repeatLabel}
        on={repeat !== 'off'}
        c={c}
        onPress={() => {
          const next = player.cycleRepeat();
          toast(next === 'one' ? 'Repeating this song' : next === 'all' ? 'Repeating the queue' : 'Repeat off');
        }}
        testID="now-repeat"
      />
    </View>
  );
}

function Action({
  icon,
  label,
  on,
  text,
  c,
  onPress,
  testID,
}: {
  icon: IconName;
  label: string;
  on?: boolean;
  text?: string | null;
  c: Palette;
  onPress: () => void;
  testID?: string;
}) {
  const tint = on ? c.accent : c.ink2;
  return (
    <Press
      onPress={onPress}
      haptic="tap"
      scale={0.92}
      hitSlop={4}
      accessibilityLabel={text ? `${label}, ${text}` : label}
      accessibilityState={{ selected: !!on }}
      style={[styles.action, on ? { backgroundColor: withAlpha(c.accent, 0.14) } : null]}
      testID={testID}>
      <Icon name={icon} size={21} color={tint} weight={on ? 'bold' : 'regular'} />
      {text ? (
        <T variant="mono" color={tint} tabular>
          {text}
        </T>
      ) : null}
    </Press>
  );
}

function Actions({ open, c }: { open: boolean; c: Palette }) {
  const lyricsOn = useUi((s) => s.nowView === 'lyrics');
  const sleep = usePlayer((s) => s.sleep);
  const speed = usePlayer((s) => s.speed);
  const now = useSecondTicker(open && sleep.endsAt !== null);
  const sleepText =
    sleep.endsAt !== null ? formatDuration(Math.max(0, sleep.endsAt - now)) : sleep.mode === 'track' ? 'End' : null;
  return (
    <View style={styles.actions}>
      <Action
        icon="quotes"
        label={lyricsOn ? 'Hide lyrics' : 'Lyrics'}
        on={lyricsOn}
        c={c}
        onPress={() => setNowView(lyricsOn ? 'art' : 'lyrics')}
        testID="now-lyrics"
      />
      <Action
        icon="timer"
        label="Sleep timer"
        on={sleepText !== null}
        text={sleepText}
        c={c}
        onPress={() => openSheet({ kind: 'sleep' })}
        testID="now-sleep"
      />
      <Action
        icon="gauge"
        label="Playback speed"
        on={speed !== 1}
        text={speed !== 1 ? `${speed}×` : null}
        c={c}
        onPress={() => openSheet({ kind: 'speed' })}
        testID="now-speed"
      />
      <Action icon="equalizer" label="Sound" c={c} onPress={() => go('/sound', 'navigate')} testID="now-sound" />
      <Action icon="queue" label="Queue" c={c} onPress={() => openSheet({ kind: 'queue' })} testID="now-queue" />
    </View>
  );
}

const styles = StyleSheet.create({
  zone: { position: 'absolute', left: 0, right: 0, top: 0 },
  topBar: {
    position: 'absolute',
    left: 8,
    right: 8,
    height: NOW_BAR_H,
    flexDirection: 'row',
    alignItems: 'center',
  },
  source: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, gap: 1 },
  artZone: { position: 'absolute' },
  titleBlock: { position: 'absolute', left: 24, right: 14 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titleText: { flex: 1, minWidth: 0 },
  artist: { marginTop: 2, alignSelf: 'flex-start', maxWidth: '100%' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, marginRight: 10 },
  metaText: { flexShrink: 1 },
  badge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, height: 20, justifyContent: 'center' },
  badgeText: { fontSize: 10, lineHeight: 12, letterSpacing: 0.8 },
  lyricsHeader: {
    position: 'absolute',
    right: 12,
    height: LYRICS_ART,
    flexDirection: 'row',
    alignItems: 'center',
  },
  lyricsHeaderPress: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 0 },
  lyricsThumbGap: { width: LYRICS_ART, height: LYRICS_ART },
  lyricsHeaderText: { flex: 1, minWidth: 0 },
  lyrics: { position: 'absolute', left: 0, right: 0 },
  controls: { position: 'absolute', left: 24, right: 24, paddingTop: 4 },
  transport: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    marginHorizontal: -6,
  },
  toggle: { alignItems: 'center' },
  dot: { position: 'absolute', bottom: 2, width: 4, height: 4, borderRadius: 2 },
  play: { width: 68, height: 68, borderRadius: 34 },
  playIcon: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 22,
    marginHorizontal: -8,
  },
  action: {
    minWidth: 44,
    height: 40,
    paddingHorizontal: 10,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
});
