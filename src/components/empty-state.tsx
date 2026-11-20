import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from './buttons';
import { Icon, type IconName } from './icon';
import { T } from './text';
import { radius, space, useTheme } from '@/theme';

/** Thrum's mark: a lime tile with a pulse through it. */
export function BrandMark({ size = 56 }: { size?: number }) {
  const c = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.mark, { width: size, height: size, borderRadius: size * 0.3, backgroundColor: c.accent }]}>
      <Icon name="waveform" size={size * 0.58} color={c.onAccent} weight="bold" />
    </View>
  );
}

type EmptyStateProps = {
  icon: IconName;
  title: string;
  body?: string;
  action?: { label: string; onPress: () => void; icon?: IconName };
  children?: ReactNode;
  compact?: boolean;
  testID?: string;
};

export function EmptyState({ icon, title, body, action, children, compact, testID }: EmptyStateProps) {
  const c = useTheme();
  return (
    <View style={[styles.wrap, compact && styles.compact]} testID={testID}>
      <View style={[styles.icon, { backgroundColor: c.fill, borderColor: c.line }]}>
        <Icon name={icon} size={28} color={c.ink2} weight="duotone" />
      </View>
      <T variant="heading" align="center">
        {title}
      </T>
      {body ? (
        <T variant="callout" color="ink3" align="center" style={styles.body}>
          {body}
        </T>
      ) : null}
      {action ? (
        <Button label={action.label} icon={action.icon} onPress={action.onPress} variant="secondary" style={styles.action} />
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  mark: { alignItems: 'center', justifyContent: 'center' },
  wrap: { alignItems: 'center', paddingHorizontal: space.xxl, paddingVertical: 56, gap: space.sm },
  compact: { paddingVertical: space.xxl },
  icon: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  body: { maxWidth: 320 },
  action: { marginTop: space.md },
});
