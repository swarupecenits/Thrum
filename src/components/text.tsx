import { StyleSheet, Text, type TextProps } from 'react-native';

import { useSettings } from '@/stores/settings';
import { bases, typo, useAccentWhen, type BasePalette, type TypeVariant } from '@/theme';

type BaseInk = 'ink' | 'ink2' | 'ink3' | 'ink4' | 'danger' | 'bg';
export type InkColor = BaseInk | 'accent' | 'onAccent';

const BASE_INKS = new Set<string>(['ink', 'ink2', 'ink3', 'ink4', 'danger', 'bg']);

export type TProps = TextProps & {
  variant?: TypeVariant;
  /** A palette ink or any colour string. */
  color?: InkColor | (string & {});
  align?: 'left' | 'center' | 'right';
  /** Fixed-width digits, for times and counters that change while you look at them. */
  tabular?: boolean;
};

export function T({ variant = 'body', color = 'ink', align, tabular, style, ...rest }: TProps) {
  const theme = useSettings((s) => s.theme);
  const wantsAccent = color === 'accent' || color === 'onAccent';
  const accent = useAccentWhen(wantsAccent);
  const base: BasePalette = bases[theme];
  const tint = BASE_INKS.has(color)
    ? base[color as BaseInk]
    : wantsAccent
      ? color === 'accent'
        ? accent.color
        : accent.on
      : color;
  return (
    <Text
      maxFontSizeMultiplier={1.35}
      {...rest}
      style={[typo[variant], { color: tint }, align ? { textAlign: align } : null, tabular ? styles.tabular : null, style]}
    />
  );
}

const styles = StyleSheet.create({
  tabular: { fontVariant: ['tabular-nums'] },
});
