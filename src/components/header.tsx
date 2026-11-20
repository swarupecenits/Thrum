import type { ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedRef,
  useAnimatedStyle,
  useScrollOffset,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TOP_BAR_H } from './layout';
import { T } from './text';
import { space, useBase } from '@/theme';

/**
 * A scroll ref plus its offset as a UI-thread value. Works with ScrollView and FlashList, so headers
 * collapse and fade every frame without any onScroll traffic to JS.
 */
export function useScrollY() {
  // `any`: the same ref goes on a ScrollView or a FlashList.
  const ref = useAnimatedRef<any>();
  const y = useScrollOffset(ref);
  return { ref, y };
}

export type HeaderMetrics = {
  /** Height of the pinned top bar, status bar included. */
  bar: number;
  /** Height of the One UI style expanded title area, status bar included. */
  large: number;
  /** Scroll offset at which the large title has fully given way to the top bar. */
  collapseAt: number;
};

/** One UI keeps titles in the top quarter of the screen so content starts within thumb reach. */
export function useHeaderMetrics(): HeaderMetrics {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const bar = insets.top + TOP_BAR_H;
  const large = insets.top + Math.round(Math.min(230, Math.max(150, height * 0.24)));
  return { bar, large, collapseAt: large - bar };
}

type LargeHeaderProps = {
  y: SharedValue<number>;
  metrics: HeaderMetrics;
  title: string;
  kicker?: string;
  subtitle?: string;
  /** Small actions pinned to the bottom-right of the title area. */
  actions?: ReactNode;
  testID?: string;
};

/** The big serif title that scrolls away (with a little parallax) as the list moves. */
export function LargeHeader({ y, metrics, title, kicker, subtitle, actions, testID }: LargeHeaderProps) {
  const fade = useAnimatedStyle(() => {
    const v = y.get();
    return {
      opacity: interpolate(v, [0, metrics.collapseAt * 0.7], [1, 0], 'clamp'),
      transform: [{ translateY: Math.max(0, v) * 0.42 }],
    };
  });
  return (
    <View style={[styles.large, { height: metrics.large }]} testID={testID}>
      <Animated.View style={[styles.largeInner, fade]}>
        <View style={styles.largeText}>
          {kicker ? (
            <T variant="label" color="ink3" numberOfLines={1}>
              {kicker}
            </T>
          ) : null}
          <T variant="hero" numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.6} accessibilityRole="header">
            {title}
          </T>
          {subtitle ? (
            <T variant="callout" color="ink3" numberOfLines={2}>
              {subtitle}
            </T>
          ) : null}
        </View>
        {actions ? <View style={styles.actions}>{actions}</View> : null}
      </Animated.View>
    </View>
  );
}

type TopBarProps = {
  y: SharedValue<number>;
  title: string;
  /** Offset where the bar turns solid and its small title appears. */
  collapseAt: number;
  left?: ReactNode;
  right?: ReactNode;
  /** Background colour once solid; the theme background by default. */
  color?: string;
  /** No bottom hairline, for when something pinned below draws its own. */
  flat?: boolean;
};

/** The pinned bar over a collapsing header: transparent at rest, solid with a small title once scrolled. */
export function TopBar({ y, title, collapseAt, left, right, color, flat }: TopBarProps) {
  const c = useBase();
  const insets = useSafeAreaInsets();
  const solid = useAnimatedStyle(() => ({
    opacity: interpolate(y.get(), [collapseAt - 60, collapseAt - 8], [0, 1], 'clamp'),
  }));
  const small = useAnimatedStyle(() => {
    const p = interpolate(y.get(), [collapseAt - 36, collapseAt + 4], [0, 1], 'clamp');
    return { opacity: p, transform: [{ translateY: (1 - p) * 8 }] };
  });
  return (
    <View pointerEvents="box-none" style={[styles.bar, { paddingTop: insets.top, height: insets.top + TOP_BAR_H }]}>
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: color ?? c.bg, borderBottomColor: c.line }, flat ? null : styles.barBg, solid]}
      />
      <View style={styles.side}>{left}</View>
      <Animated.View style={[styles.barTitle, small]} pointerEvents="none">
        <T variant="headline" numberOfLines={1}>
          {title}
        </T>
      </Animated.View>
      <View style={[styles.side, styles.right]}>{right}</View>
    </View>
  );
}

type SectionHeaderProps = {
  title: string;
  kicker?: string;
  action?: { label: string; onPress: () => void };
};

export function SectionHeader({ title, kicker, action }: SectionHeaderProps) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionText}>
        {kicker ? (
          <T variant="label" color="ink4">
            {kicker}
          </T>
        ) : null}
        <T variant="heading" accessibilityRole="header" numberOfLines={1}>
          {title}
        </T>
      </View>
      {action ? (
        <T
          variant="calloutMedium"
          color="ink3"
          onPress={action.onPress}
          suppressHighlighting
          accessibilityRole="button"
          style={styles.sectionAction}>
          {action.label}
        </T>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  large: { justifyContent: 'flex-end', paddingHorizontal: space.page, paddingBottom: space.lg },
  largeInner: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md },
  largeText: { flex: 1, gap: 4 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginBottom: 2 },
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.xs,
  },
  barBg: { borderBottomWidth: StyleSheet.hairlineWidth },
  side: { minWidth: 48, flexDirection: 'row', alignItems: 'center' },
  right: { justifyContent: 'flex-end' },
  barTitle: { flex: 1, alignItems: 'center', paddingHorizontal: space.xs },
  section: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: space.page,
    marginTop: space.xxl,
    marginBottom: space.md,
    gap: space.md,
  },
  sectionText: { flex: 1, gap: 2 },
  sectionAction: { paddingVertical: 4, paddingLeft: space.sm },
});
