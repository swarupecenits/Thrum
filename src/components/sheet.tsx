import { useEffect, type ReactNode } from 'react';
import { BackHandler, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  useAnimatedKeyboard,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { Icon, type IconName } from './icon';
import { Press } from './press';
import { T } from './text';
import { radius, space, springs, useTheme } from '@/theme';
import type { HapticKind } from '@/utils/haptics';

function useNativeKeyboardHeight(): SharedValue<number> {
  return useAnimatedKeyboard().height;
}
function useNoKeyboardHeight(): SharedValue<number> {
  return useSharedValue(0);
}
/** Reanimated can't follow the keyboard on web (and warns when asked to); the browser resizes the page there. */
const useKeyboardHeight = Platform.OS === 'web' ? useNoKeyboardHeight : useNativeKeyboardHeight;

type SheetFrameProps = {
  visible: boolean;
  onClose: () => void;
  /** Called once the exit animation has finished. */
  onClosed: () => void;
  /** 'panel' drags from anywhere; 'handle' only from the top strip, for sheets with scrolling content. */
  drag?: 'panel' | 'handle';
  /** Fixed height as a fraction of the window, for list sheets; content-sized otherwise. */
  fill?: number;
  children: ReactNode;
  testID?: string;
};

/**
 * Bottom sheet drawn in the app's own tree (no native modal), so it opens on the first frame,
 * sits above the player and keyboard, and closes with a drag, a tap outside or Back.
 */
export function SheetFrame({ visible, onClose, onClosed, drag = 'panel', fill, children, testID }: SheetFrameProps) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const { height: screen } = useWindowDimensions();
  const progress = useSharedValue(0);
  const offset = useSharedValue(0);
  const panel = useSharedValue(screen * 0.5);
  const keyboard = useKeyboardHeight();

  useEffect(() => {
    if (visible) {
      offset.set(0);
      progress.set(withSpring(1, springs.sheet));
    } else {
      progress.set(
        withTiming(0, { duration: 190, easing: Easing.in(Easing.quad) }, (finished) => {
          if (finished) scheduleOnRN(onClosed);
        }),
      );
    }
  }, [visible, progress, offset, onClosed]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  const pan = usePanGesture({
    activeOffsetY: 8,
    failOffsetX: [-24, 24],
    onUpdate: (e) => {
      'worklet';
      offset.set(Math.max(0, e.translationY) + Math.min(0, e.translationY) * 0.15);
    },
    onDeactivate: (e) => {
      'worklet';
      if (!e.canceled && (e.translationY > Math.min(140, panel.get() * 0.3) || e.velocityY > 900)) {
        scheduleOnRN(onClose);
      } else {
        offset.set(withSpring(0, springs.snappy));
      }
    },
  });

  const backdrop = useAnimatedStyle(() => ({
    opacity: progress.get() * (1 - Math.min(1, Math.max(0, offset.get()) / Math.max(panel.get(), 1))),
  }));
  const sheet = useAnimatedStyle(() => ({
    transform: [
      {
        translateY:
          (1 - progress.get()) * (panel.get() + 48) + offset.get() - Math.max(0, keyboard.get() - insets.bottom),
      },
    ],
  }));

  const maxHeight = screen - insets.top - 24;
  const body = (
    <Animated.View
      testID={testID}
      accessibilityViewIsModal
      onLayout={(e) => panel.set(e.nativeEvent.layout.height)}
      style={[
        styles.panel,
        {
          backgroundColor: c.surface,
          borderColor: c.line,
          paddingBottom: insets.bottom + space.md,
          maxHeight,
        },
        fill ? { height: Math.min(maxHeight, screen * fill) } : null,
        sheet,
      ]}>
      {drag === 'handle' ? (
        <GestureDetector gesture={pan}>
          <View style={styles.handleZone}>
            <View style={[styles.grabber, { backgroundColor: c.lineStrong }]} />
          </View>
        </GestureDetector>
      ) : (
        <View style={styles.handleZone}>
          <View style={[styles.grabber, { backgroundColor: c.lineStrong }]} />
        </View>
      )}
      {children}
      <View style={[styles.overshoot, { backgroundColor: c.surface }]} />
    </Animated.View>
  );

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={visible ? 'box-none' : 'none'}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: c.scrim }, backdrop]}>
        <Pressable style={styles.fill} onPress={onClose} accessibilityLabel="Close" accessibilityRole="button" />
      </Animated.View>
      {drag === 'panel' ? <GestureDetector gesture={pan}>{body}</GestureDetector> : body}
    </View>
  );
}

type SheetHeaderProps = {
  title: string;
  subtitle?: string;
  /** Artwork or an icon tile on the left. */
  leading?: ReactNode;
  trailing?: ReactNode;
};

export function SheetHeader({ title, subtitle, leading, trailing }: SheetHeaderProps) {
  return (
    <View style={styles.header}>
      {leading}
      <View style={styles.headerText}>
        <T variant="headline" numberOfLines={1} accessibilityRole="header">
          {title}
        </T>
        {subtitle ? (
          <T variant="small" color="ink3" numberOfLines={1}>
            {subtitle}
          </T>
        ) : null}
      </View>
      {trailing}
    </View>
  );
}

type MenuItemProps = {
  icon: IconName;
  label: string;
  detail?: string;
  onPress: () => void;
  tone?: 'default' | 'danger' | 'accent';
  trailing?: ReactNode;
  haptic?: HapticKind | false;
  disabled?: boolean;
  testID?: string;
};

export function MenuItem({ icon, label, detail, onPress, tone = 'default', trailing, haptic = 'tap', disabled, testID }: MenuItemProps) {
  const c = useTheme();
  const fg = tone === 'danger' ? c.danger : tone === 'accent' ? c.accent : c.ink;
  return (
    <Press
      onPress={onPress}
      haptic={haptic}
      disabled={disabled}
      scale={0.985}
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      testID={testID}
      style={styles.item}>
      <View style={[styles.itemIcon, { backgroundColor: tone === 'danger' ? 'rgba(248,113,113,0.12)' : c.fill }]}>
        <Icon name={icon} size={19} color={fg} />
      </View>
      <View style={styles.itemText}>
        <T variant="calloutMedium" color={fg} numberOfLines={1}>
          {label}
        </T>
        {detail ? (
          <T variant="small" color="ink3" numberOfLines={1}>
            {detail}
          </T>
        ) : null}
      </View>
      {trailing}
    </Press>
  );
}

export function MenuDivider() {
  const c = useTheme();
  return <View style={[styles.divider, { backgroundColor: c.line }]} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    paddingHorizontal: space.page,
  },
  handleZone: { alignItems: 'center', paddingTop: 10, paddingBottom: 12 },
  grabber: { width: 40, height: 5, borderRadius: 3 },
  overshoot: { position: 'absolute', left: 0, right: 0, top: '100%', height: 400 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.md, minHeight: 44 },
  headerText: { flex: 1, gap: 2 },
  item: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 54, paddingVertical: 4 },
  itemIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  itemText: { flex: 1, gap: 1 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: space.sm },
});
