import Constants from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, TextInput, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { analyzeNow } from '@/audio/services';
import { BackButton } from '@/components/back-button';
import { Button, Chip } from '@/components/buttons';
import { Card, CardHeader, Divider, Row, ToggleRow } from '@/components/card';
import { BrandMark } from '@/components/empty-state';
import { LargeHeader, TopBar, useHeaderMetrics, useScrollY } from '@/components/header';
import { Icon, type IconName } from '@/components/icon';
import { useBottomChrome } from '@/components/layout';
import { go } from '@/components/nav';
import { Press } from '@/components/press';
import { Segmented, type SegmentOption } from '@/components/segmented';
import { T } from '@/components/text';
import { useClock } from '@/hooks/use-clock';
import { formatCount, formatNumber, formatRelative, greeting } from '@/lib/format';
import { folderName } from '@/lib/library';
import { compareText } from '@/lib/text';
import { HOUR_MS, MINUTE_MS } from '@/lib/time';
import { resetAnalysis, stopAnalysis, useFeatures } from '@/stores/features';
import { clearHistory, useHistory } from '@/stores/history';
import { requestPermission, rescanAndReport, useLibrary } from '@/stores/library';
import { clearSearches, useSearches } from '@/stores/searches';
import { useSettings, type Settings, type ShuffleMode } from '@/stores/settings';
import { toast } from '@/stores/toast';
import { ACCENTS, fonts, radius, space, useTheme, type AccentId, type ThemeId } from '@/theme';
import { confirm } from '@/utils/confirm';

const GITHUB = 'https://github.com/swarupecenits';
const VERSION = Constants.expoConfig?.version ?? '1.0.0';
const MAX_NAME = 40;
/** Matches the cap in stores/settings: a longer list would be rejected when read back. */
const MAX_HIDDEN = 200;
const FOLDERS_COLLAPSED = 6;
const METER_EASE = Easing.bezier(0.22, 1, 0.36, 1);

const set = <K extends keyof Settings>(key: K, value: Settings[K]) => useSettings.getState().set(key, value);

const THEMES: readonly SegmentOption<ThemeId>[] = [
  { value: 'ink', label: 'Ink' },
  { value: 'amoled', label: 'AMOLED black', a11y: 'Pure black' },
];
const THEME_NOTE: Record<ThemeId, string> = {
  ink: 'Soft near-black, easy on the eyes in any light.',
  amoled: 'True black. OLED pixels switch off completely, which also saves a little battery.',
};

const SHUFFLES: readonly SegmentOption<ShuffleMode>[] = [
  { value: 'spread', label: 'Spread' },
  { value: 'flow', label: 'Flow' },
];
const SHUFFLE_NOTE: Record<ShuffleMode, string> = {
  spread: 'Properly mixed: artists are spaced out, so the same voice never plays twice in a row.',
  flow: 'Like a DJ set: each song leads into the next by energy, tempo and key. Best once your songs are analysed.',
};

const ADAPTIVE = ['#BEF264', '#7DD3FC', '#A78BFA', '#FB7185'] as const;
const FADES = [0, 10, 20, 45];
const MIN_LENGTHS = [0, 15, 30, 60];
const seconds = (s: number) => (s ? `${s} s` : 'Off');

type ChoiceRowProps = {
  icon: IconName;
  title: string;
  detail: string;
  options: readonly number[];
  value: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
  testID?: string;
};

/** A labelled row with a short set of chips underneath, for small numeric choices. */
function ChoiceRow({ icon, title, detail, options, value, format, onChange, testID }: ChoiceRowProps) {
  return (
    <View testID={testID}>
      <Row icon={icon} title={title} detail={detail} />
      <View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabel={title}>
        {options.map((o) => (
          <Chip
            key={o}
            size="sm"
            label={format(o)}
            selected={o === value}
            onPress={() => onChange(o)}
            testID={testID ? `${testID}-${o}` : undefined}
          />
        ))}
      </View>
    </View>
  );
}

function ProfileCard() {
  const c = useTheme();
  const saved = useSettings((s) => s.name);
  const [draft, setDraft] = useState(saved);
  const hour = useClock(HOUR_MS);
  const hello = greeting(new Date(hour), draft).title;
  const initial = Array.from(draft.trim())[0]?.toUpperCase() ?? '';

  const commit = () => {
    const clean = draft.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME);
    if (clean !== draft) setDraft(clean);
    if (clean !== saved) set('name', clean);
  };

  return (
    <Card testID="settings-profile">
      <View style={styles.profile}>
        <View style={[styles.avatar, { backgroundColor: initial ? c.accent : c.fill }]}>
          {initial ? (
            <T style={[styles.initial, { color: c.onAccent }]}>{initial}</T>
          ) : (
            <Icon name="user-circle" size={28} color={c.ink3} />
          )}
        </View>
        <View style={styles.flex}>
          <T variant="label" color="ink4">
            Home says
          </T>
          <T variant="serif" numberOfLines={1} testID="settings-greeting">
            {hello}
          </T>
        </View>
      </View>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        onBlur={commit}
        onSubmitEditing={commit}
        placeholder="Your first name"
        placeholderTextColor={c.ink4}
        maxLength={MAX_NAME}
        autoCapitalize="words"
        autoCorrect={false}
        autoComplete="given-name"
        textContentType="givenName"
        returnKeyType="done"
        selectionColor={c.accent}
        cursorColor={c.accent}
        accessibilityLabel="Your first name, for the greeting"
        testID="settings-name"
        style={[styles.input, { backgroundColor: c.fill, borderColor: c.lineStrong, color: c.ink }]}
      />
      <T variant="small" color="ink4">
        Only used for the greeting. Like everything else, it stays on this phone.
      </T>
    </Card>
  );
}

type Swatch = { id: AccentId; label: string; color: string | null; on: string };

const SWATCHES: readonly Swatch[] = [
  ...ACCENTS.map((a) => ({ id: a.id, label: a.label, color: a.color, on: a.on })),
  { id: 'adaptive', label: 'Adaptive', color: null, on: '#09090B' },
];

function AccentPicker({ value }: { value: AccentId }) {
  const c = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Accent colour" style={styles.swatches}>
      {SWATCHES.map((s) => {
        const selected = s.id === value;
        const mark = selected ? <Icon name="check" size={16} color={s.on} weight="bold" /> : null;
        return (
          <Press
            key={s.id}
            onPress={() => set('accent', s.id)}
            haptic="select"
            scale={0.88}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            aria-checked={selected}
            accessibilityLabel={s.color ? `${s.label} accent` : 'Adaptive accent, follows the artwork'}
            testID={`accent-${s.id}`}
            style={styles.swatchSlot}>
            <View style={[styles.swatchRing, { borderColor: selected ? c.ink : 'transparent' }]}>
              {s.color ? (
                <View style={[styles.swatch, { backgroundColor: s.color }]}>{mark}</View>
              ) : (
                <LinearGradient colors={ADAPTIVE} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.swatch}>
                  {mark ?? <Icon name="sparkle" size={15} color={s.on} weight="fill" />}
                </LinearGradient>
              )}
            </View>
          </Press>
        );
      })}
    </View>
  );
}

function LookCard() {
  const theme = useSettings((s) => s.theme);
  const accent = useSettings((s) => s.accent);
  const artPulse = useSettings((s) => s.artPulse);
  const haptics = useSettings((s) => s.haptics);
  const accentNote =
    accent === 'adaptive'
      ? "Adaptive: borrows a colour from the artwork that's playing."
      : `${ACCENTS.find((a) => a.id === accent)?.label ?? 'Lime'}, used for highlights, the seek bar and the bass knob.`;

  return (
    <Card testID="settings-look">
      <CardHeader kicker="Look & feel" title="Theme" detail={THEME_NOTE[theme]} />
      <Segmented options={THEMES} value={theme} onChange={(v) => set('theme', v)} label="Theme" testID="settings-theme" />
      <Divider />
      <CardHeader title="Accent" detail={accentNote} />
      <AccentPicker value={accent} />
      <Divider />
      <ToggleRow
        icon="heartbeat"
        title="Artwork pulse"
        detail="The cover breathes with the kick drum while music plays"
        value={artPulse}
        onValueChange={(v) => set('artPulse', v)}
        testID="settings-art-pulse"
      />
      <ToggleRow
        icon="vibrate"
        title="Haptics"
        detail="Soft ticks on taps, sliders and the bass knob"
        value={haptics}
        onValueChange={(v) => set('haptics', v)}
        testID="settings-haptics"
      />
    </Card>
  );
}

function PlaybackCard() {
  const shuffle = useSettings((s) => s.shuffleMode);
  const leveling = useSettings((s) => s.leveling);
  const skipSilence = useSettings((s) => s.skipSilence);
  const fade = useSettings((s) => s.sleepFadeSec);

  return (
    <Card testID="settings-playback">
      <CardHeader kicker="Playback" title="Shuffle" detail={SHUFFLE_NOTE[shuffle]} />
      <Segmented options={SHUFFLES} value={shuffle} onChange={(v) => set('shuffleMode', v)} label="Shuffle style" testID="settings-shuffle" />
      <Divider />
      <ToggleRow
        icon="gauge"
        title="Volume leveling"
        detail="Evens out loud and quiet songs. It only ever turns down, so nothing clips."
        value={leveling}
        onValueChange={(v) => set('leveling', v)}
        testID="settings-leveling"
      />
      <ToggleRow
        icon="speaker-slash"
        title="Skip silence"
        detail="Trims quiet gaps between and inside songs"
        value={skipSilence}
        onValueChange={(v) => set('skipSilence', v)}
        testID="settings-skip-silence"
      />
      <Divider />
      <ChoiceRow
        icon="moon"
        title="Sleep timer fade"
        detail="How long the music fades out before it stops"
        options={FADES}
        value={fade}
        format={seconds}
        onChange={(v) => set('sleepFadeSec', v)}
        testID="settings-fade"
      />
      <Divider />
      <Row
        icon="equalizer"
        title="Equaliser & bass"
        detail="Bass boost, 10-band EQ, presets and per-device sound"
        onPress={() => go('/sound', 'navigate')}
        testID="settings-sound"
      />
    </Card>
  );
}

type FolderItem = { id: string; name: string; path: string; songs: number | null; subfolders: number };

const trimSlash = (id: string) => id.replace(/\/+$/, '');

function FolderList() {
  const folders = useLibrary((s) => s.lib.folders);
  const excluded = useSettings((s) => s.excludedFolders);
  const [expanded, setExpanded] = useState(false);
  const hidden = useMemo(() => new Set(excluded.map((f) => f.toLowerCase())), [excluded]);

  const items = useMemo(() => {
    const byKey = new Map<string, Omit<FolderItem, 'subfolders'>>();
    for (const f of folders) {
      byKey.set(f.id.toLowerCase(), { id: f.id, name: f.name, path: trimSlash(f.id), songs: f.trackIds.length });
    }
    for (const id of excluded) {
      const key = id.toLowerCase();
      if (!byKey.has(key)) byKey.set(key, { id, name: folderName(id), path: trimSlash(id), songs: null });
    }
    // The scanner can't hide the storage root (it would hide everything), so it gets no switch.
    const list = [...byKey.values()].filter((f) => f.path !== '');
    const keys = list.map((f) => f.id.toLowerCase());
    return list
      .map((f, i) => ({ ...f, subfolders: keys.filter((k) => k !== keys[i] && k.startsWith(keys[i])).length }))
      .sort((a, b) => compareText(a.path, b.path));
  }, [folders, excluded]);

  const toggle = (item: FolderItem, include: boolean) => {
    const current = useSettings.getState().excludedFolders;
    const key = item.id.toLowerCase();
    if (include) {
      set('excludedFolders', current.filter((f) => f.toLowerCase() !== key));
      return;
    }
    if (current.some((f) => f.toLowerCase() === key)) return;
    if (current.length >= MAX_HIDDEN) {
      toast({ message: `You can hide up to ${MAX_HIDDEN} folders`, icon: 'info' });
      return;
    }
    set('excludedFolders', [...current, item.id]);
  };

  if (!items.length) {
    return <Row icon="folder" title="Folders" detail="Folders with music show up here after a scan." />;
  }

  const shown = expanded ? items : items.slice(0, FOLDERS_COLLAPSED);
  const hiddenCount = items.filter((f) => hidden.has(f.id.toLowerCase())).length;

  return (
    <View testID="settings-folders">
      <CardHeader
        title="Folders"
        detail={
          hiddenCount
            ? `${formatCount(hiddenCount, 'folder')} hidden. Switch one back on to bring its songs back.`
            : 'Switch a folder off to keep its audio, like call recordings, out of your library.'
        }
      />
      {shown.map((f) => {
        const on = !hidden.has(f.id.toLowerCase());
        const subs = f.subfolders ? `, plus ${formatCount(f.subfolders, 'subfolder')}` : '';
        const detail = on
          ? `${f.path}${f.songs === null ? '' : ` \u00b7 ${formatCount(f.songs, 'song')}`}${subs}`
          : `${f.path} \u00b7 hidden${f.subfolders ? ' with its subfolders' : ''}`;
        return (
          <ToggleRow
            key={f.id}
            icon="folder"
            title={f.name}
            detail={detail}
            value={on}
            onValueChange={(v) => toggle(f, v)}
            testID={`settings-folder-${f.path}`}
          />
        );
      })}
      {items.length > FOLDERS_COLLAPSED ? (
        <Button
          label={expanded ? 'Show fewer' : `Show all ${items.length} folders`}
          icon={expanded ? 'caret-up' : 'caret-down'}
          variant="ghost"
          size="sm"
          onPress={() => setExpanded((e) => !e)}
          style={styles.more}
          testID="settings-folders-more"
        />
      ) : null}
    </View>
  );
}

function LibraryCard() {
  const c = useTheme();
  const count = useLibrary((s) => s.lib.tracks.length);
  const scannedAt = useLibrary((s) => s.scannedAt);
  const scanning = useLibrary((s) => s.scanning);
  const permission = useLibrary((s) => s.permission);
  const minSec = useSettings((s) => s.minDurationSec);
  const now = useClock(MINUTE_MS);
  const [busy, setBusy] = useState(false);
  const granted = permission?.status === 'granted';
  const blocked = permission?.status === 'denied' && !permission.canAskAgain;
  const working = busy || scanning;

  const rescan = () => {
    setBusy(true);
    void rescanAndReport().finally(() => setBusy(false));
  };

  return (
    <Card testID="settings-library">
      <CardHeader kicker="Library" title="Your music" detail={count ? `${formatCount(count, 'song')} on this phone` : 'No songs found yet'} />
      {granted ? (
        <Row
          icon="arrows-clockwise"
          title="Rescan now"
          detail={scannedAt ? `Last scanned ${formatRelative(scannedAt, now)}` : 'Not scanned yet'}
          onPress={working ? undefined : rescan}
          right={
            working ? (
              <ActivityIndicator size="small" color={c.accent} />
            ) : (
              <T variant="calloutMedium" color="accent">
                Scan
              </T>
            )
          }
          testID="settings-rescan"
        />
      ) : (
        <Row
          icon="lock"
          title="Allow access to music"
          detail={
            blocked
              ? "Android won't ask again. Open system settings, then Permissions › Music and audio › Allow."
              : 'Thrum needs this to find the songs on your phone'
          }
          onPress={() => void (blocked ? Linking.openSettings() : requestPermission())}
          testID="settings-permission"
        />
      )}
      <Divider />
      <ChoiceRow
        icon="hourglass"
        title="Skip short files"
        detail="Hides ringtones, voice notes and WhatsApp clips shorter than this"
        options={MIN_LENGTHS}
        value={minSec}
        format={seconds}
        onChange={(v) => set('minDurationSec', v)}
        testID="settings-min-length"
      />
      <Divider />
      <FolderList />
    </Card>
  );
}

/** A thin progress bar that eases to its new length. */
function Meter({ frac }: { frac: number }) {
  const c = useTheme();
  const p = useSharedValue(frac);
  useEffect(() => {
    p.set(withTiming(frac, { duration: 600, easing: METER_EASE }));
  }, [frac, p]);
  const fill = useAnimatedStyle(() => {
    const pct = `${Math.max(0, Math.min(1, p.get())) * 100}%` as const;
    return { width: pct };
  });
  return (
    <View style={[styles.meter, { backgroundColor: c.fill }]}>
      <Animated.View style={[styles.meterFill, { backgroundColor: c.accent }, fill]} />
    </View>
  );
}

function AnalysisCard() {
  const tracks = useLibrary((s) => s.lib.tracks);
  const ready = useLibrary((s) => s.status === 'ready');
  const map = useFeatures((s) => s.map);
  const failed = useFeatures((s) => s.failed);
  const running = useFeatures((s) => s.running);
  const remaining = useFeatures((s) => s.remaining);
  const auto = useSettings((s) => s.autoAnalyze);

  // Only songs still in the library count; results for deleted files linger until the next reset.
  const { done, bad } = useMemo(() => {
    let ok = 0;
    let unreadable = 0;
    for (const t of tracks) {
      if (map.has(t.id)) ok++;
      else if (failed.has(t.id)) unreadable++;
    }
    return { done: ok, bad: unreadable };
  }, [tracks, map, failed]);
  const total = tracks.length;
  const waiting = Math.max(0, total - done - bad);
  const status = !total
    ? 'Nothing to analyse yet'
    : running
      ? `Analysing \u00b7 ${formatNumber(remaining)} to go`
      : waiting
        ? `Paused \u00b7 ${formatNumber(waiting)} waiting`
        : 'Every song is analysed';

  const start = () => {
    if (!analyzeNow()) toast({ message: 'Your library is still loading', icon: 'hourglass' });
  };
  const startOver = () =>
    confirm({
      title: 'Analyse everything again?',
      message: `Thrum forgets what it learned about ${formatCount(done + bad, 'song')} and listens again. Vibe search and Flow shuffle are less precise until it finishes.`,
      confirmLabel: 'Start over',
      onConfirm: () => {
        if (!resetAnalysis()) return;
        analyzeNow();
        toast({ message: 'Analysing your library from scratch', icon: 'sparkle' });
      },
    });

  return (
    <Card testID="settings-analysis">
      <CardHeader
        kicker="Smart features"
        title="Sound analysis"
        detail="Thrum listens to a slice of each song, on your phone, to learn its tempo, energy and key. Vibe search, mixes and Flow use it."
      />
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={`Sound analysis: ${done} of ${total} songs. ${status}`}
        accessibilityValue={{ min: 0, max: Math.max(1, total), now: done + bad }}
        style={styles.progress}>
        <View style={styles.progressTop}>
          <T variant="title" tabular testID="settings-analysed">
            {formatNumber(done)}
          </T>
          <T variant="callout" color="ink3">
            {`of ${formatCount(total, 'song')}`}
          </T>
        </View>
        <Meter frac={total ? (done + bad) / total : 0} />
        <View style={styles.progressFoot}>
          <T variant="small" color={running ? 'accent' : 'ink3'} style={styles.flex}>
            {status}
          </T>
          {bad ? (
            <T variant="small" color="ink4">
              {`${formatNumber(bad)} couldn't be read`}
            </T>
          ) : null}
        </View>
      </View>
      <ToggleRow
        icon="magic-wand"
        title="Analyse automatically"
        detail="New songs are analysed in the background after each scan"
        value={auto}
        onValueChange={(v) => set('autoAnalyze', v)}
        testID="settings-auto-analyze"
      />
      {running || waiting || done + bad ? (
        <View style={styles.actions}>
          {running ? (
            <Button label="Pause" icon="pause" size="sm" variant="secondary" onPress={stopAnalysis} testID="settings-analysis-pause" />
          ) : waiting ? (
            <Button label="Analyse now" icon="sparkle" size="sm" onPress={start} disabled={!ready} testID="settings-analysis-start" />
          ) : null}
          {done + bad ? (
            <Button
              label="Start over"
              icon="arrow-counter-clockwise"
              size="sm"
              variant="ghost"
              onPress={startOver}
              testID="settings-analysis-reset"
            />
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

function PrivacyCard() {
  const c = useTheme();
  const plays = useHistory((s) => s.plays.length);
  const searches = useSearches((s) => s.recent.length);

  const forgetPlays = () =>
    confirm({
      title: 'Clear listening history?',
      message: 'Your stats, Recently played and On repeat start fresh. Songs, playlists and favourites stay.',
      confirmLabel: 'Clear history',
      onConfirm: () => {
        if (clearHistory()) toast({ message: 'Listening history cleared', icon: 'check', tone: 'success' });
      },
    });

  return (
    <Card testID="settings-privacy">
      <CardHeader kicker="Privacy" title="Your data" />
      <Row
        icon="clock-counter-clockwise"
        title="Clear listening history"
        detail={plays ? `${formatCount(plays, 'play')} counted on this phone` : 'Nothing recorded yet'}
        tone="danger"
        disabled={!plays}
        onPress={forgetPlays}
        testID="settings-clear-history"
      />
      <Row
        icon="broom"
        title="Clear recent searches"
        detail={searches ? formatCount(searches, 'recent search', 'recent searches') : 'No recent searches'}
        disabled={!searches}
        onPress={() => {
          clearSearches();
          toast({ message: 'Recent searches cleared', icon: 'check', tone: 'success' });
        }}
        testID="settings-clear-searches"
      />
      <View style={[styles.promise, { backgroundColor: c.fill, borderColor: c.line }]}>
        <Icon name="shield-check" size={22} color={c.accent} weight="duotone" />
        <T variant="small" color="ink2" style={styles.flex}>
          No account, no ads, no tracking. Thrum works fully offline, and your music and everything it learns about it
          stay on this phone.
        </T>
      </View>
    </Card>
  );
}

function AboutCard() {
  const c = useTheme();
  return (
    <Card testID="settings-about">
      <View style={styles.about}>
        <BrandMark size={52} />
        <View style={styles.flex}>
          <T variant="serif">Thrum</T>
          <T variant="small" color="ink3">
            Offline music, felt.
          </T>
        </View>
        <T variant="mono" color="ink4" testID="settings-version">
          {`v${VERSION}`}
        </T>
      </View>
      <T variant="label" color="ink4">
        Media3 · 64-bit DSP · fully offline
      </T>
      <Divider />
      <Row
        icon="github-logo"
        title="Made by Swarup Chanda"
        detail="github.com/swarupecenits"
        onPress={() => void Linking.openURL(GITHUB).catch(() => {})}
        right={<Icon name="arrow-up-right" size={16} color={c.ink4} />}
        testID="settings-credit"
      />
    </Card>
  );
}

export default function SettingsScreen() {
  const c = useTheme();
  const { ref, y } = useScrollY();
  const metrics = useHeaderMetrics();
  const bottom = useBottomChrome(false);

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <Animated.ScrollView
        ref={ref}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        testID="settings">
        <LargeHeader y={y} metrics={metrics} kicker="Make it yours" title="Settings" testID="settings-header" />
        <View style={styles.cards}>
          <ProfileCard />
          <LookCard />
          <PlaybackCard />
          <LibraryCard />
          <AnalysisCard />
          <PrivacyCard />
          <AboutCard />
        </View>
        <View style={{ height: bottom + space.xxl }} />
      </Animated.ScrollView>
      <TopBar y={y} title="Settings" collapseAt={metrics.collapseAt} left={<BackButton />} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  cards: { gap: space.md },
  profile: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  avatar: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  initial: { fontFamily: fonts.serif, fontSize: 30, lineHeight: 36 },
  input: {
    height: 52,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.lg,
    fontFamily: fonts.sansMedium,
    fontSize: 16,
  },
  swatches: { flexDirection: 'row', justifyContent: 'space-between' },
  swatchSlot: { flex: 1, alignItems: 'center', paddingVertical: space.xs },
  swatchRing: { width: 42, height: 42, borderRadius: 21, borderWidth: 2, padding: 3 },
  swatch: { flex: 1, borderRadius: 16, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingLeft: 48, paddingBottom: space.xs },
  more: { alignSelf: 'flex-start', marginTop: space.xs },
  progress: { gap: space.sm },
  progressTop: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  progressFoot: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  meter: { height: 6, borderRadius: 3, overflow: 'hidden' },
  meterFill: { height: 6, borderRadius: 3 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  promise: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  about: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
