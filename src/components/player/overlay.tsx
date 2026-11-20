import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useEffect, useState } from 'react';
import { BackHandler, Platform, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { GeneratedCover } from '../cover';
import { Icon } from '../icon';
import { closePlayer, expand, MINI_GAP, MINI_H, TAB_BAR_H, tabsShown } from '../layout';
import { AmbientBackdrop } from './ambient';
import { LYRICS_ART, MINI_COVER, miniTopFor, useNowGeometry, type NowGeometry } from './geometry';
import { clamp01, lerp } from './gestures';
import { MiniPlayer } from './mini';
import { NowPlaying } from './now-playing';
import { useArtwork } from '@/audio/artwork';
import { bassPulse, useSpectrum } from '@/audio/spectrum';
import { useNowTrack } from '@/hooks/use-library';
import { withAlpha } from '@/lib/color';
import { useNow } from '@/stores/now';
import { usePlayer } from '@/stores/player';
import { useSettings } from '@/stores/settings';
import { setNowView, useUi } from '@/stores/ui';
import { EASE_OUT, springs, useTheme } from '@/theme';

const GLOW_ID = 'thrum-now-glow';
/** Centre of the mini player's cover, relative to the card's top-left corner on screen. */
const MINI_CX = MINI_GAP + (MINI_H - MINI_COVER) / 2 + MINI_COVER / 2;
const MINI_CY = MINI_H / 2;
const lyricsEase = Easing.bezier(...EASE_OUT);
/**
 * On web, `box-none` gives its children `pointer-events: auto`, which beats the closed panel's `none`, so the
 * invisible player would swallow taps meant for the mini player. There it hides outright once fully closed,
 * which also keeps it out of the tab order and away from screen readers.
 */
const HIDE_CLOSED = Platform.OS === 'web';
/** How far above the mini player the page starts to sink away. */
const SCRIM_LEAD = 20;
const SCRIM_H = SCRIM_LEAD + MINI_H + MINI_GAP;

/** Mini player + Now Playing, mounted once above every screen while there's something to play. */
export function PlayerOverlay() {
  const hasQueue = usePlayer((s) => s.ids.length > 0);
  const open = useUi((s) => s.playerOpen);

  useEffect(() => {
    if (!hasQueue && open) closePlayer();
  }, [hasQueue, open]);

  if (!hasQueue) return null;
  return <Overlay open={open} />;
}

function Overlay({ open }: { open: boolean }) {
  const { geo, onLayout } = useNowGeometry();
  const reduce = useReducedMotion();
  const artPulse = useSettings((s) => s.artPulse);
  const paused = usePlayer((s) => !s.playWhenReady);
  const lyricsOn = useUi((s) => s.nowView === 'lyrics');
  const pulse = artPulse && open && !reduce;
  useSpectrum(pulse);

  const lyricsP = useSharedValue(lyricsOn ? 1 : 0);
  const pausedP = useSharedValue(paused ? 1 : 0);
  const pulseOn = useSharedValue(pulse ? 1 : 0);
  const artSwipe = useSharedValue(0);
  const burst = useSharedValue(0);

  useEffect(() => {
    lyricsP.set(withTiming(lyricsOn ? 1 : 0, { duration: 420, easing: lyricsEase }));
  }, [lyricsOn, lyricsP]);
  useEffect(() => {
    pausedP.set(withSpring(paused ? 1 : 0, springs.gentle));
  }, [paused, pausedP]);
  useEffect(() => {
    // Another visualiser (the Sound screen) may keep the analyser running: ignore it here.
    pulseOn.set(withTiming(pulse ? 1 : 0, { duration: 300 }));
  }, [pulse, pulseOn]);

  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const ui = useUi.getState();
      if (ui.sheet) return false;
      if (ui.nowView === 'lyrics') setNowView('art');
      else closePlayer();
      return true;
    });
    return () => sub.remove();
  }, [open]);

  // Build Now Playing just after launch, off the critical path, so the first open is instant.
  const [ready, setReady] = useState(open);
  if (open && !ready) setReady(true);
  useEffect(() => {
    if (ready) return;
    const t = setTimeout(() => setReady(true), 250);
    return () => clearTimeout(t);
  }, [ready]);

  const { width: W, height: H, insetBottom } = geo;

  const panel = useAnimatedStyle(() => {
    const e = clamp01(expand.get());
    const shift = { transform: [{ translateY: miniTopFor(H, insetBottom, tabsShown.get()) * (1 - e) }] };
    return HIDE_CLOSED ? { ...shift, visibility: e > 0 ? 'visible' : 'hidden' } : shift;
  });
  // Starts as the mini card's exact outline, so the card looks like it grows into the screen.
  const surface = useAnimatedStyle(() => {
    const e = clamp01(expand.get());
    return {
      opacity: clamp01(e * 6),
      borderRadius: 18 * (1 - e),
      transform: [{ scaleX: 1 - ((2 * MINI_GAP) / W) * (1 - e) }],
    };
  });
  const content = useAnimatedStyle(() => ({ opacity: clamp01((expand.get() - 0.35) / 0.45) }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" onLayout={onLayout}>
      <MiniScrim geo={geo} />
      <MiniPlayer geo={geo} />
      <Animated.View
        style={[styles.panel, { height: H }, panel]}
        pointerEvents={open ? 'box-none' : 'none'}
        accessibilityElementsHidden={!open}
        importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
        testID="now-playing">
        <Animated.View style={[StyleSheet.absoluteFill, styles.surface, surface]}>
          <AmbientBackdrop />
        </Animated.View>
        <Glow geo={geo} lyricsP={lyricsP} pulseOn={pulseOn} />
        <Animated.View style={[StyleSheet.absoluteFill, content]} pointerEvents="box-none">
          {ready ? <NowPlaying geo={geo} open={open} lyricsP={lyricsP} artSwipe={artSwipe} burst={burst} /> : null}
        </Animated.View>
      </Animated.View>
      <FlyingArt geo={geo} lyricsP={lyricsP} pausedP={pausedP} pulseOn={pulseOn} artSwipe={artSwipe} burst={burst} />
    </View>
  );
}

/**
 * The page fades out under the floating mini player instead of showing through around it: down to the
 * tab bar, or to the bottom edge on screens without one. Transforms and opacity only, so it costs nothing.
 */
const MiniScrim = memo(function MiniScrim({ geo }: { geo: NowGeometry }) {
  const c = useTheme();
  const { height: H, insetBottom } = geo;
  const fade = useAnimatedStyle(() => ({ opacity: 1 - clamp01(expand.get() * 3) }));
  const band = useAnimatedStyle(() => ({
    transform: [{ translateY: H - insetBottom - tabsShown.get() * TAB_BAR_H - SCRIM_H }],
  }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, fade]} pointerEvents="none">
      <Animated.View style={[styles.scrimBand, band]}>
        <LinearGradient
          colors={[withAlpha(c.bg, 0), withAlpha(c.bg, 0.86), c.bg]}
          locations={[0, 0.55, 1]}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      {/* Over the tab bar this matches the bar's bottom padding exactly; on stack screens it covers the system bar. */}
      {insetBottom > 0 ? <View style={[styles.scrimBase, { height: insetBottom, backgroundColor: c.bg }]} /> : null}
    </Animated.View>
  );
});

/** A soft bloom of the artwork's colour behind it that swells with the bass. */
const Glow = memo(function Glow({
  geo,
  lyricsP,
  pulseOn,
}: {
  geo: NowGeometry;
  lyricsP: SharedValue<number>;
  pulseOn: SharedValue<number>;
}) {
  const color = useNow((s) => s.ambient.glow);
  const { art } = geo;
  const G = Math.round(art.size * 1.6);
  const style = useAnimatedStyle(() => {
    const e = clamp01(expand.get());
    const l = clamp01(lyricsP.get());
    const b = bassPulse.get() * pulseOn.get();
    return {
      opacity: (0.55 + b * 0.45) * clamp01((e - 0.6) / 0.4) * (1 - l),
      transform: [{ scale: 1 + b * 0.12 }],
    };
  });
  return (
    <Animated.View
      style={[
        styles.glow,
        { left: art.x + art.size / 2 - G / 2, top: art.y + art.size / 2 - G / 2, width: G, height: G },
        style,
      ]}
      pointerEvents="none"
      renderToHardwareTextureAndroid>
      <Svg width={G} height={G}>
        <Defs>
          <RadialGradient id={GLOW_ID} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={color} stopOpacity={1} />
            <Stop offset="0.55" stopColor={color} stopOpacity={0.35} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width={G} height={G} fill={`url(#${GLOW_ID})`} />
      </Svg>
    </Animated.View>
  );
});

type FlyingArtProps = {
  geo: NowGeometry;
  lyricsP: SharedValue<number>;
  pausedP: SharedValue<number>;
  pulseOn: SharedValue<number>;
  artSwipe: SharedValue<number>;
  burst: SharedValue<number>;
};

/**
 * One artwork for every state: it flies from the mini player's cover to the big square, and on to
 * the lyrics thumbnail. Drawn at full size and scaled, so moving it never re-lays anything out.
 */
const FlyingArt = memo(function FlyingArt({ geo, lyricsP, pausedP, pulseOn, artSwipe, burst }: FlyingArtProps) {
  const { art, lyricsArt, width: W, height: H, insetBottom } = geo;
  const A = art.size;
  const artCx = art.x + A / 2;
  const artCy = art.y + A / 2;
  const lyrCx = lyricsArt.x + LYRICS_ART / 2;
  const lyrCy = lyricsArt.y + LYRICS_ART / 2;

  const frame = useAnimatedStyle(() => {
    const e = clamp01(expand.get());
    const l = clamp01(lyricsP.get());
    const swipe = artSwipe.get() * (1 - l);
    const b = bassPulse.get() * pulseOn.get();
    const miniTop = miniTopFor(H, insetBottom, tabsShown.get());
    const cx = lerp(MINI_CX, lerp(artCx, lyrCx, l), e) + swipe;
    const cy = miniTop * (1 - e) + lerp(MINI_CY, lerp(artCy, lyrCy, l), e);
    const k = lerp(MINI_COVER, lerp(A, LYRICS_ART, l), e) / A;
    const breathe = 1 + b * 0.045 * e * (1 - l);
    const rest = 1 - 0.1 * clamp01(pausedP.get()) * e * (1 - l);
    const drag = 1 - Math.min(0.08, (Math.abs(swipe) / W) * 0.15);
    return {
      // Takes over from the mini cover the instant the player starts to open.
      opacity: clamp01(e * 40),
      borderRadius: (8 + 6 * e * (1 - l)) / k,
      transform: [{ translateX: cx - A / 2 }, { translateY: cy - A / 2 }, { scale: k * breathe * rest * drag }],
    };
  });

  const heart = useAnimatedStyle(() => {
    const p = burst.get();
    const opacity = p <= 0 || p >= 1 ? 0 : p < 0.2 ? p / 0.2 : 1 - (p - 0.2) / 0.8;
    const scale = p < 0.3 ? lerp(0.4, 1.2, p / 0.3) : p < 0.5 ? lerp(1.2, 1, (p - 0.3) / 0.2) : 1 + (p - 0.5) * 0.12;
    return { opacity, transform: [{ scale }] };
  });

  return (
    <Animated.View style={[styles.art, { width: A, height: A }, frame]} pointerEvents="none">
      <NowArt size={A} />
      <Animated.View style={[styles.heart, heart]}>
        <Icon name="heart" size={Math.round(A * 0.28)} color="#FFFFFF" weight="fill" />
      </Animated.View>
    </Animated.View>
  );
});

/**
 * The playing track's large artwork. Shows the small (already decoded) cover while the large one
 * loads, and keeps the previous artwork up rather than flashing an empty frame between tracks.
 */
function NowArt({ size }: { size: number }) {
  const track = useNowTrack();
  const albumId = track?.albumId ?? null;
  const trackId = track?.id ?? null;
  const lg = useArtwork(albumId, trackId, 'lg');
  const sm = useArtwork(albumId, trackId, 'sm');
  const current = lg ?? (sm?.uri ? sm : undefined);
  const [last, setLast] = useState(current);
  if (current !== undefined && current !== last) setLast(current);
  const uri = (current ?? last)?.uri ?? null;

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        cachePolicy="memory"
        transition={{ duration: 280, effect: 'cross-dissolve' }}
        accessible={false}
      />
    );
  }
  return <GeneratedCover seed={albumId ?? 'thrum'} label={track?.album ?? 'Thrum'} size={size} />;
}

const styles = StyleSheet.create({
  panel: { position: 'absolute', left: 0, right: 0, top: 0 },
  scrimBand: { position: 'absolute', left: 0, right: 0, top: 0, height: SCRIM_H },
  scrimBase: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  surface: { overflow: 'hidden' },
  glow: { position: 'absolute' },
  art: { position: 'absolute', left: 0, top: 0, overflow: 'hidden' },
  heart: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
});
