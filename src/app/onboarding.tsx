import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/buttons';
import { BrandMark } from '@/components/empty-state';
import { Icon, type IconName } from '@/components/icon';
import { T } from '@/components/text';
import { withAlpha } from '@/lib/color';
import { requestPermission, useLibrary } from '@/stores/library';
import { useSettings } from '@/stores/settings';
import { radius, space, useTheme } from '@/theme';

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'shield-check',
    title: 'Yours, offline',
    body: 'No account, no streaming, no tracking. Your music and what you play never leave this phone.',
  },
  {
    icon: 'speaker-hifi',
    title: 'Bass-first sound',
    body: 'A native engine with a 10-band EQ, phantom bass and a limiter that keeps the low end clean.',
  },
  {
    icon: 'magic-wand',
    title: 'Search by feel',
    body: 'Say \u201cchill late night\u201d or \u201cbass heavy punjabi\u201d and Thrum finds the songs that fit.',
  },
];

const enter = (i: number) => FadeInDown.delay(80 + i * 70).duration(520);

function finish() {
  useSettings.getState().set('onboarded', true);
}

export default function Onboarding() {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState(false);
  const status = useLibrary((s) => s.permission?.status);
  const blocked = useLibrary((s) => s.permission?.status === 'denied' && s.permission.canAskAgain === false);

  // Allowed from system settings while Thrum was in the background: carry straight on.
  useEffect(() => {
    if (asked && status === 'granted') finish();
  }, [asked, status]);

  const allow = async () => {
    setAsked(true);
    if (blocked) {
      void Linking.openSettings().catch(() => {});
      return;
    }
    setBusy(true);
    const p = await requestPermission();
    setBusy(false);
    if (p.status === 'granted') finish();
  };

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]} testID="onboarding">
      <LinearGradient
        pointerEvents="none"
        colors={[withAlpha(c.accent, 0.16), withAlpha(c.accent, 0)]}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={styles.glow}
      />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + space.xxl * 2, paddingBottom: insets.bottom + space.xl }]}>
        <Animated.View entering={enter(0)}>
          <BrandMark size={64} />
        </Animated.View>
        <Animated.View entering={enter(1)} style={styles.hero}>
          <T variant="label" color="accent">
            Thrum
          </T>
          <T variant="hero" accessibilityRole="header">
            {'Offline music,\nfelt.'}
          </T>
          <T variant="callout" color="ink3">
            A bass-first player for the songs already on your phone.
          </T>
        </Animated.View>

        <View style={styles.features}>
          {FEATURES.map((f, i) => (
            <Animated.View key={f.title} entering={enter(i + 2)} style={styles.feature}>
              <View style={[styles.featureIcon, { backgroundColor: withAlpha(c.accent, 0.12) }]}>
                <Icon name={f.icon} size={22} color={c.accent} weight="bold" />
              </View>
              <View style={styles.flex}>
                <T variant="headline">{f.title}</T>
                <T variant="callout" color="ink3">
                  {f.body}
                </T>
              </View>
            </Animated.View>
          ))}
        </View>

        <View style={styles.flex} />
        <Animated.View entering={enter(5)} style={styles.actions}>
          {status === 'denied' ? (
            <T variant="small" color="ink3" align="center" testID="onboarding-denied">
              {blocked
                ? "Android won't ask again. Open Settings \u203a Permissions \u203a Music and audio, choose Allow, then come back."
                : 'Thrum needs this to find your songs. It only ever reads audio files.'}
            </T>
          ) : null}
          <Button
            label={blocked ? 'Open settings' : 'Allow access to music'}
            icon={blocked ? 'gear-six' : 'music-notes'}
            size="lg"
            busy={busy}
            onPress={() => void allow()}
            testID="onboarding-allow"
          />
          <Button label="Not now" variant="ghost" onPress={finish} testID="onboarding-skip" />
          <T variant="small" color="ink4" align="center">
            Audio files only. Never your photos, videos or contacts.
          </T>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 460 },
  content: { flexGrow: 1, paddingHorizontal: space.page, gap: space.xl },
  hero: { gap: space.sm },
  features: { gap: space.lg, marginTop: space.sm },
  feature: { flexDirection: 'row', alignItems: 'flex-start', gap: space.lg },
  featureIcon: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  actions: { gap: space.sm, marginTop: space.lg },
});
