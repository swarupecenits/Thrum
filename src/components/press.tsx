import type { ReactNode } from 'react';
import { Platform, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { springs } from '@/theme';
import { haptic as buzz, type HapticKind } from '@/utils/haptics';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * `role` for a tappable surface that holds buttons of its own. On web a button role renders a real `<button>`,
 * which can't contain other buttons, so there the surface becomes a focusable group; native keeps the button.
 */
export const surfaceRole = Platform.OS === 'web' ? ('group' as const) : undefined;

export type PressProps = Omit<PressableProps, 'style' | 'children'> & {
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  haptic?: HapticKind | false;
  /** Scale while held down; 1 turns the effect off. */
  scale?: number;
};

/** Pressable with a quick spring "give": the tactile base for every tappable surface. */
export function Press({
  haptic = false,
  scale = 0.97,
  onPressIn,
  onPressOut,
  onPress,
  style,
  disabled,
  children,
  ...rest
}: PressProps) {
  const pressed = useSharedValue(0);
  const dim = disabled ? 0.4 : 1;
  const animated = useAnimatedStyle(() => ({
    opacity: dim * (1 - 0.1 * pressed.get()),
    transform: [{ scale: 1 - (1 - scale) * pressed.get() }],
  }));

  return (
    <AnimatedPressable
      accessibilityRole="button"
      aria-disabled={!!disabled}
      disabled={disabled}
      {...rest}
      onPressIn={(e) => {
        pressed.set(withTiming(1, { duration: 70 }));
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        pressed.set(withSpring(0, springs.snappy));
        onPressOut?.(e);
      }}
      onPress={
        onPress
          ? (e) => {
              if (haptic) buzz(haptic);
              onPress(e);
            }
          : undefined
      }
      style={[style, animated]}>
      {children}
    </AnimatedPressable>
  );
}
