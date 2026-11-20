import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon, type IconName } from './icon';
import { Switch } from './switch';
import { T } from './text';
import { radius, space, useBase } from '@/theme';
import { haptic } from '@/utils/haptics';

type CardProps = { children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string };

/** A quiet raised surface that groups related controls. */
export function Card({ children, style, testID }: CardProps) {
  const c = useBase();
  return (
    <View testID={testID} style={[styles.card, { backgroundColor: c.surface, borderColor: c.line }, style]}>
      {children}
    </View>
  );
}

type CardHeaderProps = { title: string; kicker?: string; detail?: string; right?: ReactNode };

export function CardHeader({ title, kicker, detail, right }: CardHeaderProps) {
  return (
    <View style={styles.header}>
      <View style={styles.headerText}>
        {kicker ? (
          <T variant="label" color="ink4" numberOfLines={1}>
            {kicker}
          </T>
        ) : null}
        <T variant="headline" numberOfLines={1} accessibilityRole="header">
          {title}
        </T>
        {detail ? (
          <T variant="small" color="ink3" numberOfLines={3}>
            {detail}
          </T>
        ) : null}
      </View>
      {right}
    </View>
  );
}

type RowProps = {
  icon?: IconName;
  title: string;
  detail?: string;
  /** Value text, a button or a badge. Pressable rows without one get a caret. */
  right?: ReactNode;
  onPress?: () => void;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  testID?: string;
};

function RowBody({ icon, title, detail, right, tone, showCaret }: RowProps & { showCaret: boolean }) {
  const c = useBase();
  const danger = tone === 'danger';
  return (
    <>
      {icon ? (
        <View style={[styles.rowIcon, { backgroundColor: danger ? 'rgba(248,113,113,0.12)' : c.fill }]}>
          <Icon name={icon} size={18} color={danger ? c.danger : c.ink2} />
        </View>
      ) : null}
      <View style={styles.rowText}>
        <T variant="bodyMedium" color={danger ? 'danger' : 'ink'} numberOfLines={1}>
          {title}
        </T>
        {detail ? (
          <T variant="small" color="ink3" numberOfLines={3}>
            {detail}
          </T>
        ) : null}
      </View>
      {right ?? (showCaret ? <Icon name="caret-right" size={16} color={c.ink4} /> : null)}
    </>
  );
}

/** A settings-style line inside a Card; the whole row is the touch target when `onPress` is set. */
export function Row(props: RowProps) {
  const c = useBase();
  const { onPress, disabled, title, detail, testID } = props;
  if (!onPress) {
    return (
      <View style={[styles.row, disabled ? styles.disabled : null]} testID={testID}>
        <RowBody {...props} showCaret={false} />
      </View>
    );
  }
  return (
    <Pressable
      onPress={() => {
        haptic('tap');
        onPress();
      }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={detail ? `${title}. ${detail}` : title}
      accessibilityState={{ disabled: !!disabled }}
      testID={testID}
      style={({ pressed }) => [styles.row, styles.pressable, pressed && { backgroundColor: c.fill }, disabled ? styles.disabled : null]}>
      <RowBody {...props} showCaret />
    </Pressable>
  );
}

type ToggleRowProps = {
  icon?: IconName;
  title: string;
  detail?: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  testID?: string;
};

/** A row with a switch; tapping anywhere on it flips the switch (the switch stays the accessible control). */
export function ToggleRow({ icon, title, detail, value, onValueChange, disabled, testID }: ToggleRowProps) {
  const c = useBase();
  return (
    <Pressable
      accessible={false}
      disabled={disabled}
      onPress={() => {
        haptic('select');
        onValueChange(!value);
      }}
      style={({ pressed }) => [styles.row, styles.pressable, pressed && { backgroundColor: c.fill }, disabled ? styles.disabled : null]}>
      <RowBody
        icon={icon}
        title={title}
        detail={detail}
        showCaret={false}
        right={<Switch value={value} onValueChange={onValueChange} label={title} disabled={disabled} testID={testID} />}
      />
    </Pressable>
  );
}

export function Divider() {
  const c = useBase();
  return <View style={[styles.divider, { backgroundColor: c.line }]} />;
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: space.page,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.lg,
    gap: space.md,
    overflow: 'hidden',
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  headerText: { flex: 1, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52, paddingVertical: space.xs },
  pressable: { marginHorizontal: -space.sm, paddingHorizontal: space.sm, borderRadius: radius.md },
  rowIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, gap: 2 },
  disabled: { opacity: 0.45 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: space.xxs },
});
