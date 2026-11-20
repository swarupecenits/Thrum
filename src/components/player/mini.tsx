import { memo } from 'react';
import { PixelRatio, StyleSheet, View } from 'react-native';
import {
  GestureDetector,
  useCompetingGestures,
  useLongPressGesture,
  usePanGesture,
  useTapGesture,
} from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { IconButton } from '../buttons';
import { Cover } from '../cover';
import { expand, MINI_GAP, MINI_H, openPlayer, setPlayerOpen, tabsShown } from '../layout';
import { T } from '../text';
import { MINI_COVER, miniTopFor, type NowGeometry } from './geometry';
import { clamp01 } from './gestures';
import { durationMs, positionMs } from '@/audio/clock';
import { useNowTrack } from '@/hooks/use-library';
import { mix, withAlpha } from '@/lib/color';
import { useNow } from '@/stores/now';
import { player, usePlayer } from '@/stores/player';
import { openSheet } from '@/stores/ui';
import { springs, useTheme } from '@/theme';
import { haptic } from '@/utils/haptics';

const RADIUS = 18;
const PAD = (MINI_H - MINI_COVER) / 2;
const BAR_INSET = 16;

/**
 * The floating "now playing" card. Tap or drag up to open Now Playing (it follows the finger),
 * swipe sideways to change track, long-press for the queue.
 */
function MiniPlayerBase({ geo }: { geo: NowGeometry }) {
  const c = useTheme();
  const track = useNowTrack();
  const tint = useNow((s) => s.ambient.top);
  const playing = usePlayer((s) => s.playWhenReady);
  const canNext = usePlayer((s) => s.index < s.ids.length - 1 || (s.repeat === 'all' && s.ids.length > 1));
  const swipe = useSharedValue(0);
  const start = useSharedValue(0);
  const { width, height, insetBottom } = geo;
  const barW = Math.max(1, width - MINI_GAP * 2 - BAR_INSET * 2);
  const px = PixelRatio.get();

  const skip = (dir: number) => {
    haptic('select');
    if (dir > 0) player.next();
    else player.previousTrack();
  };
  const showQueue = () => {
    haptic('soft');
    openSheet({ kind: 'queue' });
  };

  const tap = useTapGesture({
    maxDistance: 10,
    onActivate: () => {
      'worklet';
      expand.set(withSpring(1, springs.player));
      scheduleOnRN(setPlayerOpen, true);
    },
  });

  const lift = usePanGesture({
    activeOffsetY: [-8, 8],
    failOffsetX: [-14, 14],
    onActivate: () => {
      'worklet';
      cancelAnimation(expand);
      start.set(expand.get());
    },
    onUpdate: (e) => {
      'worklet';
      const travel = Math.max(1, miniTopFor(height, insetBottom, tabsShown.get()));
      expand.set(clamp01(start.get() - e.translationY / travel));
    },
    onDeactivate: (e) => {
      'worklet';
      const travel = Math.max(1, miniTopFor(height, insetBottom, tabsShown.get()));
      const open = !e.canceled && (e.velocityY < -500 || (expand.get() > 0.3 && e.velocityY < 500));
      expand.set(withSpring(open ? 1 : 0, { ...springs.player, velocity: -e.velocityY / travel }));
      if (open) scheduleOnRN(setPlayerOpen, true);
    },
  });

  const slide = usePanGesture({
    activeOffsetX: [-12, 12],
    failOffsetY: [-10, 10],
    onUpdate: (e) => {
      'worklet';
      swipe.set(e.translationX < 0 && !canNext ? e.translationX * 0.3 : e.translationX);
    },
    onDeactivate: (e) => {
      'worklet';
      const dx = e.translationX;
      const vx = e.velocityX;
      const dir = dx < 0 ? 1 : -1;
      const reversed = Math.abs(vx) > 300 && Math.sign(vx) !== Math.sign(dx);
      const far = Math.abs(dx) > 80 || Math.abs(vx) > 700;
      if (e.canceled || reversed || !far || (dir > 0 && !canNext)) {
        swipe.set(withSpring(0, springs.snappy));
        return;
      }
      scheduleOnRN(skip, dir);
      swipe.set(
        withSequence(
          withTiming(-dir * width * 0.5, { duration: 150, easing: Easing.in(Easing.quad) }),
          withTiming(dir * 70, { duration: 0 }),
          withSpring(0, springs.snappy),
        ),
      );
    },
  });

  const hold = useLongPressGesture({
    minDuration: 420,
    onActivate: () => {
      'worklet';
      scheduleOnRN(showQueue);
    },
  });

  const gesture = useCompetingGestures(lift, slide, hold, tap);

  const card = useAnimatedStyle(() => {
    const e = clamp01(expand.get());
    return {
      opacity: e > 0.995 ? 0 : 1,
      transform: [{ translateY: miniTopFor(height, insetBottom, tabsShown.get()) * (1 - e) }],
    };
  });
  const row = useAnimatedStyle(() => {
    const e = clamp01(expand.get());
    const s = swipe.get();
    return {
      opacity: (1 - clamp01(e * 4)) * (1 - clamp01(Math.abs(s) / 160)),
      transform: [{ translateX: s }],
    };
  });
  // The flying artwork takes over from this cover the moment the player starts to open.
  const cover = useAnimatedStyle(() => ({ opacity: 1 - clamp01(expand.get() * 40) }));
  const buttons = useAnimatedStyle(() => ({ opacity: 1 - clamp01(expand.get() * 4) }));

  const progress = useDerivedValue(() => {
    // Hidden behind Now Playing: park instead of re-rendering every frame.
    if (expand.get() > 0.98) return 0;
    const d = durationMs.get();
    if (d <= 0) return 0;
    // Whole device pixels: the bar only redraws when it visibly moves.
    return Math.round(clamp01(positionMs.get() / d) * barW * px) / (barW * px);
  });
  const bar = useAnimatedStyle(() => ({
    opacity: 1 - clamp01(expand.get() * 4),
    transform: [{ scaleX: Math.max(0.0001, progress.get()) }],
  }));

  if (!track) return null;

  return (
    <Animated.View
      style={[
        styles.card,
        { backgroundColor: mix(c.raised, tint, 0.4), borderColor: c.lineStrong },
        card,
      ]}
      testID="mini-player">
      <GestureDetector gesture={gesture}>
        <View
          style={styles.zone}
          accessible
          accessibilityRole="button"
          accessibilityLabel={`Now playing: ${track.title} by ${track.artist}`}
          accessibilityHint="Opens the player. Swipe sideways to change track."
          accessibilityActions={[{ name: 'activate' }, { name: 'longpress', label: 'Show queue' }]}
          onAccessibilityAction={(e) => {
            if (e.nativeEvent.actionName === 'longpress') showQueue();
            else openPlayer();
          }}>
          <Animated.View style={[styles.row, row]}>
            <Animated.View style={cover}>
              <Cover albumId={track.albumId} trackId={track.id} label={track.album} size={MINI_COVER} rounded={8} />
            </Animated.View>
            <View style={styles.text}>
              <T variant="calloutMedium" numberOfLines={1}>
                {track.title}
              </T>
              <T variant="caption" color="ink3" numberOfLines={1}>
                {track.artist}
              </T>
            </View>
          </Animated.View>
        </View>
      </GestureDetector>
      <Animated.View style={[styles.buttons, buttons]}>
        <IconButton
          icon={playing ? 'pause' : 'play'}
          label={playing ? 'Pause' : 'Play'}
          weight="fill"
          iconSize={24}
          haptic="soft"
          onPress={() => player.toggle()}
          testID="mini-play"
        />
        <IconButton
          icon="skip-forward"
          label="Next"
          weight="fill"
          iconSize={22}
          disabled={!canNext}
          onPress={() => player.next()}
          testID="mini-next"
        />
      </Animated.View>
      <View style={[styles.track, { backgroundColor: withAlpha(c.ink, 0.12) }]} pointerEvents="none">
        <Animated.View style={[styles.fill, { backgroundColor: c.accent }, bar]} />
      </View>
    </Animated.View>
  );
}

export const MiniPlayer = memo(MiniPlayerBase);

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    left: MINI_GAP,
    right: MINI_GAP,
    top: 0,
    height: MINI_H,
    borderRadius: RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  zone: { flex: 1, alignSelf: 'stretch', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: PAD, gap: 12 },
  text: { flex: 1, minWidth: 0 },
  buttons: { flexDirection: 'row', alignItems: 'center', paddingRight: 6 },
  track: {
    position: 'absolute',
    left: BAR_INSET,
    right: BAR_INSET,
    bottom: 4,
    height: 2,
    borderRadius: 1,
    overflow: 'hidden',
  },
  fill: { ...StyleSheet.absoluteFill, transformOrigin: 'left' },
});
