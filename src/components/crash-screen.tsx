import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from './buttons';
import { BrandMark } from './empty-state';
import { T } from './text';
import { radius, space, useTheme } from '@/theme';

type CrashScreenProps = {
  title: string;
  message: string;
  onRetry: () => void;
};

export function CrashScreen({ title, message, onRetry }: CrashScreenProps) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  return (
    <View
      style={[styles.root, { backgroundColor: c.bg, paddingTop: insets.top + space.xxl, paddingBottom: insets.bottom + space.xl }]}>
      <View style={styles.body}>
        <BrandMark size={56} />
        <T variant="serif">{title}</T>
        <T variant="callout" color="ink2">
          Your music, playlists and sound settings are safe. Try again, and if it keeps happening, restart the app.
        </T>
        <T variant="calloutMedium" color="accent" onPress={() => setOpen((v) => !v)} accessibilityRole="button">
          {open ? 'Hide details' : 'Show details'}
        </T>
        {open ? (
          <ScrollView style={[styles.details, { backgroundColor: c.surface2 }]}>
            <T variant="mono" color="ink2" selectable>
              {message}
            </T>
          </ScrollView>
        ) : null}
      </View>
      <Button label="Try again" icon="arrow-counter-clockwise" onPress={onRetry} size="lg" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: space.page },
  body: { flex: 1, gap: space.md },
  details: { maxHeight: 240, borderRadius: radius.md, padding: space.md },
});
