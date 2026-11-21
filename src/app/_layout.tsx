import '@/utils/web-setup';

import { Geist_400Regular } from '@expo-google-fonts/geist/400Regular';
import { Geist_500Medium } from '@expo-google-fonts/geist/500Medium';
import { Geist_600SemiBold } from '@expo-google-fonts/geist/600SemiBold';
import { Geist_700Bold } from '@expo-google-fonts/geist/700Bold';
import { GeistMono_500Medium } from '@expo-google-fonts/geist-mono/500Medium';
import { useFonts } from 'expo-font';
import { type ErrorBoundaryProps, Stack, ThemeProvider, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import FrauncesDisplay from '@/assets/fonts/Fraunces-Display.ttf';
import FrauncesDisplayItalic from '@/assets/fonts/Fraunces-DisplayItalic.ttf';
import FrauncesMedium from '@/assets/fonts/Fraunces-Medium.ttf';
import FrauncesSemiBold from '@/assets/fonts/Fraunces-SemiBold.ttf';
import { startServices } from '@/audio/services';
import { CrashScreen } from '@/components/crash-screen';
import { setTabsShown } from '@/components/layout';
import { PlayerOverlay } from '@/components/player/overlay';
import { SheetHost } from '@/components/sheets/host';
import { ToastHost } from '@/components/toast-host';
import { openDb } from '@/db/open';
import { boot } from '@/stores/boot';
import { reportWriteError } from '@/stores/persist';
import { useSettings } from '@/stores/settings';
import { fonts, navigationTheme, useTheme } from '@/theme';
import { seedWebDemo } from '@/utils/web-demo';

void SplashScreen.preventAutoHideAsync().catch(() => {});
SplashScreen.setOptions({ duration: 250, fade: true });

export const unstable_settings = { anchor: '(tabs)' };

let starting: Promise<void> | null = null;

function startOnce(): Promise<void> {
  starting ??= openDb(reportWriteError)
    .then((db) => boot(db))
    .then(() => seedWebDemo());
  return starting;
}

type Phase = { kind: 'loading' } | { kind: 'ready' } | { kind: 'failed'; message: string };

const describe = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : String(error));

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    Geist_700Bold,
    GeistMono_500Medium,
    [fonts.serif]: FrauncesDisplay,
    [fonts.serifItalic]: FrauncesDisplayItalic,
    [fonts.serifMedium]: FrauncesMedium,
    [fonts.serifSemi]: FrauncesSemiBold,
  });
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  // Fall back to system fonts rather than refusing to open.
  const settled = (fontsLoaded || !!fontError) && phase.kind !== 'loading';

  useEffect(() => {
    let alive = true;
    startOnce().then(
      () => {
        if (alive) setPhase({ kind: 'ready' });
      },
      (error: unknown) => {
        starting = null;
        if (alive) setPhase({ kind: 'failed', message: describe(error) });
      },
    );
    return () => {
      alive = false;
    };
  }, [attempt]);

  useEffect(() => {
    if (settled) void SplashScreen.hideAsync().catch(() => {});
  }, [settled]);

  if (!settled) return null;
  if (phase.kind === 'failed') {
    return (
      <CrashScreen
        title="Thrum couldn't open its storage"
        message={phase.message}
        onRetry={() => {
          setPhase({ kind: 'loading' });
          setAttempt((n) => n + 1);
        }}
      />
    );
  }
  return <App />;
}

const DETAIL = { animation: 'ios_from_right' } as const;

function App() {
  const c = useTheme();
  const onboarded = useSettings((s) => s.onboarded);
  const segments = useSegments();
  const inTabs = segments[0] === '(tabs)';

  useEffect(() => {
    setTabsShown(inTabs);
  }, [inTabs]);

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(c.bg).catch(() => {});
  }, [c.bg]);

  // Native listeners, the permission check and the first scan wait until the first frame is up.
  useEffect(() => {
    const id = requestAnimationFrame(() => startServices());
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <GestureHandlerRootView style={[styles.root, { backgroundColor: c.bg }]}>
      <ThemeProvider value={navigationTheme(c)}>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
          <Stack.Protected guard={onboarded}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="album/[id]" options={DETAIL} />
            <Stack.Screen name="artist/[id]" options={DETAIL} />
            <Stack.Screen name="playlist/[id]" options={DETAIL} />
            <Stack.Screen name="genre/[id]" options={DETAIL} />
            <Stack.Screen name="folder/[id]" options={DETAIL} />
            <Stack.Screen name="mix/[id]" options={DETAIL} />
            <Stack.Screen name="stats" options={DETAIL} />
            <Stack.Screen name="settings" options={DETAIL} />
          </Stack.Protected>
          <Stack.Protected guard={!onboarded}>
            <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
          </Stack.Protected>
        </Stack>
        <PlayerOverlay />
        <SheetHost />
        <ToastHost />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return <CrashScreen title="Something went wrong" message={describe(error)} onRetry={() => void retry()} />;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
