import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon, type IconName, type IconWeight } from './icon';
import { Press } from './press';
import { T } from './text';
import { isDark } from '@/lib/color';
import { radius, space, useTheme } from '@/theme';
import type { HapticKind } from '@/utils/haptics';

type IconButtonTone = 'plain' | 'fill' | 'accent' | 'raised' | 'ink';

export type IconButtonProps = {
  icon: IconName;
  /** Spoken label; icon-only buttons always need one. */
  label: string;
  onPress?: () => void;
  onLongPress?: () => void;
  size?: number;
  iconSize?: number;
  weight?: IconWeight;
  color?: string;
  tone?: IconButtonTone;
  haptic?: HapticKind | false;
  disabled?: boolean;
  selected?: boolean;
  /** A small accent dot in the corner, e.g. "a timer is running". */
  badge?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function IconButton({
  icon,
  label,
  onPress,
  onLongPress,
  size = 44,
  iconSize,
  weight = 'regular',
  color,
  tone = 'plain',
  haptic = 'tap',
  disabled,
  selected,
  badge,
  style,
  testID,
}: IconButtonProps) {
  const c = useTheme();
  const bg =
    tone === 'fill'
      ? c.fill
      : tone === 'accent'
        ? c.accent
        : tone === 'raised'
          ? c.surface2
          : tone === 'ink'
            ? c.ink
            : 'transparent';
  const fg = color ?? (tone === 'accent' ? c.onAccent : tone === 'ink' ? c.bg : c.ink);
  const slop = Math.max(0, Math.ceil((48 - size) / 2));
  return (
    <Press
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected }}
      onPress={onPress}
      onLongPress={onLongPress}
      haptic={haptic}
      disabled={disabled}
      hitSlop={slop}
      scale={0.9}
      testID={testID}
      style={[styles.center, { width: size, height: size, borderRadius: size / 2, backgroundColor: bg }, style]}>
      <Icon name={icon} size={iconSize ?? Math.round(size * 0.5)} color={fg} weight={weight} />
      {badge ? <View style={[styles.badge, { backgroundColor: c.accent, borderColor: c.bg }]} /> : null}
    </Press>
  );
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'ink';

export type ButtonProps = {
  label: string;
  onPress?: () => void;
  icon?: IconName;
  iconRight?: IconName;
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  busy?: boolean;
  haptic?: HapticKind | false;
  /** Take the remaining width in a row. */
  grow?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const HEIGHTS = { sm: 36, md: 46, lg: 56 } as const;

export function Button({
  label,
  onPress,
  icon,
  iconRight,
  variant = 'primary',
  size = 'md',
  disabled,
  busy,
  haptic = 'tap',
  grow,
  style,
  testID,
}: ButtonProps) {
  const c = useTheme();
  const [bg, fg] =
    variant === 'primary'
      ? [c.accent, c.onAccent]
      : variant === 'secondary'
        ? [c.fillStrong, c.ink]
        : variant === 'danger'
          ? ['rgba(248,113,113,0.14)', c.danger]
          : variant === 'ink'
            ? [c.ink, c.bg]
            : ['transparent', c.ink2];
  const iconSize = size === 'sm' ? 16 : 19;
  return (
    <Press
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      onPress={busy ? undefined : onPress}
      haptic={haptic}
      disabled={disabled}
      testID={testID}
      style={[
        styles.button,
        {
          height: HEIGHTS[size],
          paddingHorizontal: size === 'sm' ? 14 : size === 'lg' ? 26 : 20,
          backgroundColor: bg,
        },
        grow ? styles.grow : null,
        style,
      ]}>
      {busy ? (
        <ActivityIndicator size="small" color={fg} />
      ) : icon ? (
        <Icon name={icon} size={iconSize} color={fg} weight="bold" />
      ) : null}
      <T variant="button" color={fg} numberOfLines={1} style={size === 'sm' ? styles.smallLabel : null}>
        {label}
      </T>
      {iconRight ? <Icon name={iconRight} size={iconSize} color={fg} weight="bold" /> : null}
    </Press>
  );
}

export type ChipProps = {
  label: string;
  icon?: IconName;
  iconWeight?: IconWeight;
  selected?: boolean;
  /** Custom selected colour (mood chips); the label colour is picked for contrast. */
  color?: string;
  onPress?: () => void;
  onLongPress?: () => void;
  /** A trailing "x", for removable chips. */
  removable?: boolean;
  size?: 'sm' | 'md';
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function Chip({
  label,
  icon,
  iconWeight = 'regular',
  selected,
  color,
  onPress,
  onLongPress,
  removable,
  size = 'md',
  style,
  testID,
}: ChipProps) {
  const c = useTheme();
  const on = color ?? c.accent;
  const bg = selected ? on : c.fill;
  const fg = selected ? (color ? (isDark(color) ? '#FAFAFA' : '#09090B') : c.onAccent) : c.ink2;
  const small = size === 'sm';
  return (
    <Press
      accessibilityLabel={removable ? `Remove ${label}` : label}
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      onLongPress={onLongPress}
      haptic={onPress ? 'select' : false}
      scale={0.95}
      testID={testID}
      style={[
        styles.chip,
        {
          height: small ? 30 : 36,
          paddingHorizontal: small ? 11 : 14,
          backgroundColor: bg,
          borderColor: selected ? 'transparent' : c.line,
        },
        style,
      ]}>
      {icon ? <Icon name={icon} size={small ? 14 : 16} color={fg} weight={iconWeight} /> : null}
      <T variant={small ? 'small' : 'caption'} color={fg} numberOfLines={1}>
        {label}
      </T>
      {removable ? <Icon name="x" size={12} color={fg} weight="bold" /> : null}
    </Press>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: 7,
    right: 7,
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 2,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderRadius: radius.pill,
  },
  grow: { flex: 1 },
  smallLabel: { fontSize: 13 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
