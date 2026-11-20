import { Tabs } from 'expo-router/js-tabs';

import { TabBar } from '@/components/tab-bar';
import { useTheme } from '@/theme';

export default function TabsLayout() {
  const c = useTheme();
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: false,
        freezeOnBlur: true,
        animation: 'fade',
        sceneStyle: { backgroundColor: c.bg },
      }}>
      <Tabs.Screen name="index" options={{ title: 'For you' }} />
      <Tabs.Screen name="library" options={{ title: 'Library' }} />
      <Tabs.Screen name="vibe" options={{ title: 'Vibe' }} />
      <Tabs.Screen name="sound" options={{ title: 'Sound' }} />
    </Tabs>
  );
}
