import { LinearGradient } from 'expo-linear-gradient';
import { memo, useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Icon } from '../icon';
import { expand } from '../layout';
import { T } from '../text';
import { ambientAt } from './ambient';
import { positionMs } from '@/audio/clock';
import { useTags } from '@/audio/tags';
import { withAlpha } from '@/lib/color';
import { parseLyrics, type LyricLine } from '@/lib/lrc';
import { useNow } from '@/stores/now';
import { player } from '@/stores/player';
import { fonts, useBase } from '@/theme';
import { haptic } from '@/utils/haptics';

/** Lines light up a touch early: singers land on the beat, eyes need a moment to move. */
const LEAD_MS = 150;
/** Where the active line rests, as a share of the visible height. */
const ANCHOR = 0.3;
const RESUME_MS = 3500;
const FADE_TOP = 28;
const FADE_BOTTOM = 44;

type LyricsProps = {
  trackId: string | null;
  /** Window y of the list's top edge, and the window height (to blend the edge fades). */
  top: number;
  height: number;
  windowHeight: number;
};

function LyricsBase({ trackId, top, height, windowHeight }: LyricsProps) {
  const ambient = useNow((s) => s.ambient);
  const tags = useTags(trackId);
  const lyrics = tags === undefined ? undefined : parseLyrics(tags?.lyrics);

  const topColor = ambientAt(ambient, top / windowHeight);
  const topEnd = ambientAt(ambient, (top + FADE_TOP) / windowHeight);
  const bottomColor = ambientAt(ambient, (top + height) / windowHeight);
  const bottomStart = ambientAt(ambient, (top + height - FADE_BOTTOM) / windowHeight);

  return (
    <View style={styles.fill} testID="lyrics">
      {lyrics === undefined ? null : lyrics === null ? (
        <NoLyrics />
      ) : lyrics.synced ? (
        <SyncedLyrics key={trackId} lines={lyrics.lines} height={height} />
      ) : (
        <PlainLyrics lines={lyrics.lines} />
      )}
      <LinearGradient
        pointerEvents="none"
        colors={[topColor, withAlpha(topEnd, 0)]}
        style={[styles.fade, { top: 0, height: FADE_TOP }]}
      />
      <LinearGradient
        pointerEvents="none"
        colors={[withAlpha(bottomStart, 0), bottomColor]}
        style={[styles.fade, { bottom: 0, height: FADE_BOTTOM }]}
      />
    </View>
  );
}

export const Lyrics = memo(LyricsBase);

type LineProps = {
  i: number;
  line: LyricLine;
  smooth: SharedValue<number>;
  onLine: (i: number, y: number) => void;
  onSeek: (ms: number) => void;
};

const Line = memo(function Line({ i, line, smooth, onLine, onSeek }: LineProps) {
  const style = useAnimatedStyle(() => {
    const d = i - smooth.get();
    const a = Math.abs(d);
    return {
      opacity: d < 0 ? Math.max(0.3, 1 - a * 0.7) : Math.max(0.5, 1 - a * 0.5),
      transform: [{ scale: 1 - Math.min(1, a) * 0.045 }],
    };
  });
  const gap = !line.text;
  return (
    <Pressable
      onPress={() => onSeek(line.timeMs)}
      onLayout={(e) => onLine(i, e.nativeEvent.layout.y)}
      accessibilityRole="button"
      accessibilityLabel={gap ? 'Instrumental' : line.text}
      accessibilityHint="Plays from this line"
      style={styles.linePress}>
      <Animated.Text style={[gap ? styles.gap : styles.line, style]} maxFontSizeMultiplier={1.25}>
        {gap ? '• • •' : line.text}
      </Animated.Text>
    </Pressable>
  );
});

/**
 * Time-synced lyrics: the line being sung glides to a fixed spot, sung lines dim, tap any line to
 * jump there. Scrolling by hand pauses the follow for a few seconds.
 */
function SyncedLyrics({ lines, height }: { lines: LyricLine[]; height: number }) {
  const ref = useAnimatedRef<Animated.ScrollView>();
  const times = useSharedValue<number[]>(lines.map((l) => l.timeMs));
  const offsets = useSharedValue<number[]>([]);
  const scrollY = useSharedValue(0);
  const glide = useSharedValue(0);
  const hold = useSharedValue(0);
  const resync = useSharedValue(0);
  const placed = useSharedValue(0);
  const smooth = useSharedValue(-1);
  const layout = useRef<number[]>([]);
  const frame = useRef<number | null>(null);
  const resume = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bumps = useRef(0);

  const idx = useDerivedValue(() => {
    // Player closed: park, so nothing below re-runs on every frame of the clock.
    if (expand.get() < 0.01) return -2;
    const t = times.get();
    const p = positionMs.get() + LEAD_MS;
    if (!t.length || p < t[0]) return -1;
    let lo = 0;
    let hi = t.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (t[mid] <= p) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  });

  useAnimatedReaction(
    () => idx.get(),
    (i, prev) => {
      if (i === prev) return;
      if (prev === null) smooth.set(i);
      else smooth.set(withTiming(i, { duration: 420, easing: Easing.out(Easing.cubic) }));
    },
  );

  useAnimatedReaction(
    () => ({ i: idx.get(), o: offsets.get(), r: resync.get() }),
    (cur, prev) => {
      if (cur.i < -1 || !cur.o.length || hold.get()) return;
      if (prev && cur.i === prev.i && cur.o === prev.o && cur.r === prev.r) return;
      const y = cur.o[Math.max(0, cur.i)];
      if (y === undefined) return;
      const target = Math.max(0, y - height * ANCHOR);
      if (!placed.get()) {
        placed.set(1);
        glide.set(target);
        scrollTo(ref, 0, target, false);
        return;
      }
      glide.set(scrollY.get());
      glide.set(withTiming(target, { duration: 700, easing: Easing.bezier(0.22, 1, 0.36, 1) }));
    },
  );

  useAnimatedReaction(
    () => glide.get(),
    (y, prev) => {
      if (prev === null || hold.get() || !placed.get()) return;
      scrollTo(ref, 0, y, false);
    },
  );

  const stopResume = () => {
    if (resume.current) clearTimeout(resume.current);
    resume.current = null;
  };
  const follow = () => {
    stopResume();
    hold.set(0);
    bumps.current += 1;
    resync.set(bumps.current);
  };
  const queueResume = () => {
    stopResume();
    resume.current = setTimeout(follow, RESUME_MS);
  };

  useEffect(
    () => () => {
      if (resume.current) clearTimeout(resume.current);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.set(e.contentOffset.y);
    },
    onBeginDrag: () => {
      hold.set(1);
      cancelAnimation(glide);
      scheduleOnRN(stopResume);
    },
    onEndDrag: () => {
      scheduleOnRN(queueResume);
    },
    onMomentumBegin: () => {
      scheduleOnRN(stopResume);
    },
    onMomentumEnd: () => {
      scheduleOnRN(queueResume);
    },
  });

  const onLine = (i: number, y: number) => {
    layout.current[i] = y;
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null;
      offsets.set(layout.current.slice());
    });
  };

  const onSeek = (ms: number) => {
    haptic('select');
    player.seek(ms);
    follow();
  };

  return (
    <Animated.ScrollView
      ref={ref}
      onScroll={onScroll}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}
      overScrollMode="never"
      contentContainerStyle={{ paddingTop: height * ANCHOR, paddingBottom: height * 0.62 }}>
      {lines.map((line, i) => (
        <Line key={i} i={i} line={line} smooth={smooth} onLine={onLine} onSeek={onSeek} />
      ))}
    </Animated.ScrollView>
  );
}

function PlainLyrics({ lines }: { lines: LyricLine[] }) {
  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      overScrollMode="never"
      contentContainerStyle={styles.plainContent}>
      <T variant="label" color="ink4" style={styles.plainKicker}>
        Not time-synced
      </T>
      {lines.map((l, i) => (
        <T key={i} variant="body" color="ink2" style={styles.plain} maxFontSizeMultiplier={1.25}>
          {l.text}
        </T>
      ))}
    </ScrollView>
  );
}

function NoLyrics() {
  const c = useBase();
  return (
    <View style={styles.empty}>
      <Icon name="quotes" size={34} color={c.ink4} weight="duotone" />
      <T variant="headline" align="center">
        No lyrics in this file
      </T>
      <T variant="callout" color="ink3" align="center" style={styles.emptyBody}>
        Thrum reads lyrics embedded in your music (USLT, SYLT or a LYRICS tag). Synced LRC lyrics scroll along with
        the song. Add them with a tag editor, then rescan.
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  fade: { position: 'absolute', left: 0, right: 0 },
  linePress: { paddingHorizontal: 24, paddingVertical: 7 },
  line: {
    fontFamily: fonts.sansBold,
    fontSize: 27,
    lineHeight: 35,
    letterSpacing: -0.5,
    color: '#FAFAFA',
    transformOrigin: 'left center',
  },
  gap: {
    fontFamily: fonts.sansBold,
    fontSize: 22,
    lineHeight: 35,
    letterSpacing: 2,
    color: '#FAFAFA',
    transformOrigin: 'left center',
  },
  plainContent: { paddingHorizontal: 24, paddingTop: 18, paddingBottom: 80 },
  plainKicker: { marginBottom: 14 },
  plain: { fontFamily: fonts.sansSemi, fontSize: 21, lineHeight: 31, marginBottom: 6 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 36, paddingBottom: 24 },
  emptyBody: { maxWidth: 320 },
});
