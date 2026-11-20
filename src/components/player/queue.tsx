import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { GestureDetector, ScrollView as GestureScrollView, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Button, IconButton } from '../buttons';
import { Cover } from '../cover';
import { Icon } from '../icon';
import { NowBars } from '../now-bars';
import { SheetHeader } from '../sheet';
import { T } from '../text';
import { formatCount, formatDuration, formatTotalDuration } from '@/lib/format';
import type { Track } from '@/lib/types';
import { useLibrary } from '@/stores/library';
import { currentIndex, player, usePlayer } from '@/stores/player';
import { toast } from '@/stores/toast';
import { closeSheet, openSheet } from '@/stores/ui';
import { radius, space, useBase, useTheme } from '@/theme';
import { haptic } from '@/utils/haptics';

const ROW_H = 60;
const EDGE = 72;
const MAX_SPEED = 900;

type Drag = {
  /** Index being dragged, -1 when idle. */
  from: SharedValue<number>;
  /** Slot it would drop into. */
  to: SharedValue<number>;
  /** Top of the floating row, in list-viewport coordinates. */
  y: SharedValue<number>;
  /** 1 once the floating row is on screen, so the source row only hides when its stand-in is there. */
  shown: SharedValue<number>;
  scrollY: SharedValue<number>;
  viewport: SharedValue<number>;
  /** Auto-scroll velocity in px/s while the finger is near an edge. */
  speed: SharedValue<number>;
  count: SharedValue<number>;
};

function RowBody({ track, current, past }: { track: Track | undefined; current: boolean; past: boolean }) {
  const c = useBase();
  return (
    <>
      <View style={past ? styles.past : null}>
        <Cover albumId={track?.albumId} trackId={track?.id} label={track?.album ?? ''} size={42} rounded={8} />
        {current ? (
          <View style={styles.coverOverlay}>
            <NowBars size={14} />
          </View>
        ) : null}
      </View>
      <View style={[styles.text, past ? styles.past : null]}>
        <T variant="calloutMedium" color={current ? 'accent' : 'ink'} numberOfLines={1}>
          {track?.title ?? 'Missing track'}
        </T>
        <T variant="small" color="ink3" numberOfLines={1}>
          {track ? `${track.artist} · ${formatDuration(track.durationMs)}` : 'No longer on this phone'}
        </T>
      </View>
      <View style={styles.handle}>
        <Icon name="dots-six-vertical" size={20} color={c.ink3} />
      </View>
    </>
  );
}

type RowProps = {
  id: string;
  index: number;
  current: boolean;
  past: boolean;
  drag: Drag;
  onDragStart: (index: number) => void;
  onDrop: (from: number, to: number) => void;
};

function QueueRowBase({ id, index, current, past, drag, onDragStart, onDrop }: RowProps) {
  const c = useBase();
  const track = useLibrary((s) => s.lib.byId.get(id));
  const start = useSharedValue(0);

  const pan = usePanGesture({
    minDistance: 0,
    onActivate: () => {
      'worklet';
      const top = index * ROW_H - drag.scrollY.get();
      start.set(top);
      drag.y.set(top);
      drag.from.set(index);
      drag.to.set(index);
      scheduleOnRN(onDragStart, index);
    },
    onUpdate: (e) => {
      'worklet';
      if (drag.from.get() !== index) return;
      const vh = drag.viewport.get();
      const y = Math.min(vh - ROW_H / 2, Math.max(-ROW_H / 2, start.get() + e.translationY));
      drag.y.set(y);
      const to = Math.min(drag.count.get() - 1, Math.max(0, Math.round((y + drag.scrollY.get()) / ROW_H)));
      if (to !== drag.to.get()) {
        drag.to.set(to);
        scheduleOnRN(haptic, 'tick');
      }
      if (y < EDGE) drag.speed.set(-MAX_SPEED * Math.min(1, (EDGE - y) / EDGE));
      else if (y > vh - ROW_H - EDGE) drag.speed.set(MAX_SPEED * Math.min(1, (y - (vh - ROW_H - EDGE)) / EDGE));
      else drag.speed.set(0);
    },
    onFinalize: () => {
      'worklet';
      if (drag.from.get() !== index) return;
      drag.speed.set(0);
      const from = drag.from.get();
      const to = drag.to.get();
      drag.y.set(
        withTiming(to * ROW_H - drag.scrollY.get(), { duration: 140 }, () => {
          scheduleOnRN(onDrop, from, to);
        }),
      );
    },
  });

  const style = useAnimatedStyle(() => {
    const from = drag.from.get();
    if (from < 0) return { opacity: 1, transform: [{ translateY: 0 }] };
    if (from === index) return { opacity: drag.shown.get() ? 0 : 1, transform: [{ translateY: 0 }] };
    const to = drag.to.get();
    let shift = 0;
    if (from < to && index > from && index <= to) shift = -ROW_H;
    else if (from > to && index >= to && index < from) shift = ROW_H;
    return { opacity: 1, transform: [{ translateY: withTiming(shift, { duration: 150 }) }] };
  });

  return (
    <Animated.View style={style}>
      <Pressable
        onPress={() => player.skipTo(index)}
        onLongPress={() => {
          haptic('soft');
          openSheet({ kind: 'track', trackId: id, queueIndex: index });
        }}
        delayLongPress={320}
        accessibilityRole="button"
        accessibilityLabel={`${track?.title ?? 'Missing track'}${current ? ', now playing' : ''}`}
        accessibilityHint="Plays this track. Long press for options."
        accessibilityActions={[
          { name: 'moveUp', label: 'Move up' },
          { name: 'moveDown', label: 'Move down' },
        ]}
        onAccessibilityAction={(e) => {
          const to = e.nativeEvent.actionName === 'moveUp' ? index - 1 : index + 1;
          if (to >= 0 && to < drag.count.get()) player.move(index, to);
        }}
        style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.fill }]}>
        <RowBody track={track} current={current} past={past} />
        <GestureDetector gesture={pan}>
          <View style={styles.handleZone} accessibilityLabel="Drag to reorder" />
        </GestureDetector>
      </Pressable>
    </Animated.View>
  );
}

const QueueRow = memo(QueueRowBase);

function Floating({ id, drag, index }: { id: string; drag: Drag; index: number }) {
  const c = useTheme();
  const track = useLibrary((s) => s.lib.byId.get(id));
  const current = usePlayer((s) => s.trackId === id && currentIndex() === index);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: drag.y.get() }, { scale: 1.02 }] }));
  useLayoutEffect(() => {
    drag.shown.set(1);
  }, [drag]);
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.floating,
        { backgroundColor: c.raised, borderColor: c.lineStrong },
        style,
      ]}>
      <View style={styles.row}>
        <RowBody track={track} current={current} past={false} />
      </View>
    </Animated.View>
  );
}

export function QueueSheet() {
  const c = useTheme();
  const ids = usePlayer((s) => s.ids);
  const source = usePlayer((s) => s.source);
  const shuffled = usePlayer((s) => s.original !== null);
  const repeat = usePlayer((s) => s.repeat);
  const cur = usePlayer(() => currentIndex());
  const byId = useLibrary((s) => s.lib.byId);
  const listRef = useRef<FlashListRef<string>>(null);
  const [dragging, setDragging] = useState<{ index: number; id: string } | null>(null);

  const from = useSharedValue(-1);
  const to = useSharedValue(-1);
  const y = useSharedValue(0);
  const shown = useSharedValue(0);
  const scrollY = useSharedValue(0);
  const viewport = useSharedValue(0);
  const speed = useSharedValue(0);
  const count = useSharedValue(ids.length);
  const [dragState] = useState<Drag>(() => ({ from, to, y, shown, scrollY, viewport, speed, count }));
  useEffect(() => {
    count.set(ids.length);
  }, [count, ids.length]);

  const scrollTo = (offset: number) => listRef.current?.scrollToOffset({ offset, animated: false });

  const auto = useFrameCallback((frame) => {
    'worklet';
    const v = dragState.speed.get();
    if (v === 0 || dragState.from.get() < 0) return;
    const dt = Math.min(0.05, (frame.timeSincePreviousFrame ?? 16) / 1000);
    const max = Math.max(0, dragState.count.get() * ROW_H - dragState.viewport.get());
    const next = Math.min(max, Math.max(0, dragState.scrollY.get() + v * dt));
    if (next === dragState.scrollY.get()) return;
    dragState.scrollY.set(next);
    scheduleOnRN(scrollTo, next);
    const to = Math.min(dragState.count.get() - 1, Math.max(0, Math.round((dragState.y.get() + next) / ROW_H)));
    if (to !== dragState.to.get()) dragState.to.set(to);
  }, false);

  const onDragStart = (index: number) => {
    haptic('soft');
    setDragging({ index, id: usePlayer.getState().ids[index] });
    auto.setActive(true);
  };

  const onDrop = (from: number, to: number) => {
    auto.setActive(false);
    if (from !== to) player.move(from, to);
    else reset();
  };

  const reset = () => {
    dragState.from.set(-1);
    dragState.to.set(-1);
    dragState.shown.set(0);
    setDragging(null);
  };

  // The reordered list has rendered: drop the shifts in the same frame the rows take their new places.
  useLayoutEffect(() => {
    if (dragState.from.get() >= 0) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  const upcoming = ids.slice(cur + 1);
  let left = 0;
  for (const id of upcoming) left += byId.get(id)?.durationMs ?? 0;
  const subtitle = [source ? `From ${source.label}` : null, upcoming.length ? `${formatCount(upcoming.length, 'track')} · ${formatTotalDuration(left)} left` : 'Nothing up next']
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <SheetHeader
        title="Up next"
        subtitle={subtitle}
        trailing={
          <View style={styles.headerActions}>
            <IconButton
              icon="shuffle"
              label={shuffled ? 'Turn shuffle off' : 'Shuffle'}
              weight={shuffled ? 'bold' : 'regular'}
              color={shuffled ? c.accent : c.ink2}
              selected={shuffled}
              size={40}
              onPress={player.toggleShuffle}
            />
            <IconButton
              icon="list-plus"
              label="Save queue as a playlist"
              color={c.ink2}
              size={40}
              disabled={!ids.length}
              onPress={() => openSheet({ kind: 'new-playlist', trackIds: ids })}
            />
          </View>
        }
      />
      <View
        style={styles.listBox}
        onLayout={(e) => dragState.viewport.set(e.nativeEvent.layout.height)}>
        <FlashList
          ref={listRef}
          data={ids}
          renderScrollComponent={GestureScrollView}
          keyExtractor={(id, i) => `${i}:${id}`}
          extraData={cur}
          initialScrollIndex={Math.max(0, cur)}
          onScroll={(e) => {
            if (dragState.from.get() < 0) dragState.scrollY.set(e.nativeEvent.contentOffset.y);
          }}
          scrollEventThrottle={16}
          scrollEnabled={dragging === null}
          showsVerticalScrollIndicator={false}
          renderItem={({ item, index }) => (
            <QueueRow
              id={item}
              index={index}
              current={index === cur}
              past={index < cur}
              drag={dragState}
              onDragStart={onDragStart}
              onDrop={onDrop}
            />
          )}
          ListFooterComponent={
            <View style={styles.footer}>
              <T variant="small" color="ink4" align="center">
                {repeat === 'all' ? 'Repeat is on, so the queue starts over' : repeat === 'one' ? 'Repeating the current track' : 'End of the queue'}
              </T>
              {upcoming.length ? (
                <Button
                  label="Clear up next"
                  variant="ghost"
                  size="sm"
                  icon="broom"
                  onPress={() => {
                    const before = usePlayer.getState().ids.slice(cur + 1);
                    player.clearUpcoming();
                    toast({
                      message: `Cleared ${formatCount(before.length, 'track')}`,
                      icon: 'broom',
                      action: { label: 'Undo', onPress: () => player.addToQueue(before) },
                    });
                  }}
                />
              ) : null}
            </View>
          }
        />
        {dragging ? <Floating id={dragging.id} index={dragging.index} drag={dragState} /> : null}
      </View>
      {ids.length === 0 ? (
        <View style={styles.empty}>
          <T variant="callout" color="ink3">
            The queue is empty.
          </T>
          <Button label="Close" variant="secondary" size="sm" onPress={closeSheet} />
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', gap: 2 },
  listBox: { flex: 1, marginHorizontal: -space.page },
  row: {
    height: ROW_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingLeft: space.page,
    paddingRight: space.sm,
  },
  past: { opacity: 0.42 },
  coverOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  text: { flex: 1, gap: 1 },
  handle: { width: 44, height: ROW_H, alignItems: 'center', justifyContent: 'center' },
  handleZone: { position: 'absolute', right: 0, top: 0, width: 60, height: ROW_H },
  floating: {
    position: 'absolute',
    left: space.sm,
    right: space.sm,
    top: 0,
    height: ROW_H,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    boxShadow: '0 10px 28px rgba(0,0,0,0.55)',
    overflow: 'hidden',
  },
  footer: { alignItems: 'center', gap: space.sm, paddingVertical: space.xl },
  empty: { alignItems: 'center', gap: space.md, paddingVertical: space.xl },
});
