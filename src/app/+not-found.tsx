import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { useTheme } from '@/theme';

export default function NotFound() {
  const c = useTheme();
  return (
    <View style={[styles.root, { backgroundColor: c.bg }]} testID="not-found">
      <EmptyState
        icon="map-trifold"
        title="Nothing plays here"
        body="This page doesn't exist, or the music it pointed to has moved."
        action={{ label: 'Go home', icon: 'house', onPress: () => router.replace('/') }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center' },
});
