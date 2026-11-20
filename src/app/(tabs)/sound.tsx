import { useScrollToTop } from 'expo-router';
import { useEffect, useMemo, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Button } from '@/components/buttons';
import { Card, CardHeader, Divider, ToggleRow } from '@/components/card';
import { LargeHeader, TopBar, useHeaderMetrics, useScrollY } from '@/components/header';
import { Icon } from '@/components/icon';
import { useBottomChrome } from '@/components/layout';
import { Press } from '@/components/press';
import { Slider } from '@/components/slider';
import { BassKnob } from '@/components/sound/bass-knob';
import { EqGraph } from '@/components/sound/eq-graph';
import { OutputMeters } from '@/components/sound/meters';
import { PresetStrip } from '@/components/sound/preset-strip';
import { profileName, ROUTE_KIND, routeIcon } from '@/components/sound/route';
import { Switch } from '@/components/switch';
import { T } from '@/components/text';
import { withAlpha } from '@/lib/color';
import { FLAT_SOUND, matchPreset, PRESETS } from '@/lib/eq';
import { formatDb } from '@/lib/format';
import { compareText } from '@/lib/text';
import { resetSound, setBand, setBypass, setPerDevice, updateSound, useSound } from '@/stores/sound';
import { toast } from '@/stores/toast';
import { radius, space, useTheme } from '@/theme';
import { confirm } from '@/utils/confirm';
import { haptic } from '@/utils/haptics';

/** Phantom bass the phone-speaker tip suggests: clearly audible, short of harsh. */
const SPEAKER_PHANTOM = 0.6;
/** Long enough that a tap never blips the sound off; short enough to feel instant. */
const COMPARE_HOLD_MS = 180;

const near = (a: number, b: number) => Math.abs(a - b) < 0.005;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const hz = (v: number) => `${Math.round(v)} Hz`;
const widthLabel = (v: number) => (near(v, 0) ? 'Mono' : near(v, 1) ? 'Normal' : pct(v));
const balanceLabel = (v: number) => (near(v, 0) ? 'Centre' : `${pct(Math.abs(v))} ${v < 0 ? 'left' : 'right'}`);

function dbAmount(db: number): string {
  const r = Math.round(Math.abs(db) * 10) / 10;
  return `${Number.isInteger(r) ? r : r.toFixed(1)} dB`;
}

type SliderRowProps = { title: string; value: string; detail?: string; children: ReactNode };

function SliderRow({ title, value, detail, children }: SliderRowProps) {
  return (
    <View style={styles.sliderRow}>
      <View style={styles.sliderTop}>
        <T variant="bodyMedium" numberOfLines={1} style={styles.flex}>
          {title}
        </T>
        <T variant="mono" color="ink2" tabular>
          {value}
        </T>
      </View>
      {children}
      {detail ? (
        <T variant="small" color="ink4">
          {detail}
        </T>
      ) : null}
    </View>
  );
}

/** One UI's master switch: a bar you can tap anywhere, tinted while the effect is on. */
function MasterBar() {
  const c = useTheme();
  const enabled = useSound((s) => s.params.enabled);
  const toggle = (next: boolean) => updateSound({ enabled: next });
  return (
    <Pressable
      accessible={false}
      onPress={() => {
        haptic('select');
        toggle(!enabled);
      }}
      style={[
        styles.master,
        {
          backgroundColor: enabled ? withAlpha(c.accent, 0.12) : c.surface,
          borderColor: enabled ? withAlpha(c.accent, 0.35) : c.line,
        },
      ]}>
      <View style={styles.flex}>
        <T variant="headline" color={enabled ? 'accent' : 'ink'}>
          {enabled ? 'On' : 'Off'}
        </T>
        <T variant="small" color="ink3" numberOfLines={2}>
          {enabled ? 'Thrum Sound is shaping every song' : "You're hearing every song exactly as it was mastered"}
        </T>
      </View>
      <Switch value={enabled} onValueChange={toggle} label="Thrum Sound" testID="sound-enabled" />
    </Pressable>
  );
}

/** Press and hold for the untouched signal; let go to hear your sound again. */
function CompareButton() {
  const c = useTheme();
  const bypass = useSound((s) => s.bypass);
  const enabled = useSound((s) => s.params.enabled);
  // A hold must never outlive the screen, or the sound would stay switched off.
  useEffect(() => () => setBypass(false), []);
  return (
    <Press
      delayLongPress={COMPARE_HOLD_MS}
      onLongPress={() => {
        haptic('select');
        setBypass(true);
      }}
      onPressOut={() => setBypass(false)}
      onPress={() => toast({ message: 'Hold to hear the original. Let go for your sound.', icon: 'ear' })}
      disabled={!enabled}
      scale={0.94}
      hitSlop={8}
      accessibilityLabel="Compare with the original"
      accessibilityHint="Press and hold to hear the song without Thrum Sound"
      accessibilityState={{ disabled: !enabled, selected: bypass }}
      testID="sound-compare"
      style={[styles.compare, { backgroundColor: bypass ? c.ink : c.fill }]}>
      <Icon name="ear" size={16} color={bypass ? c.bg : c.ink2} />
      <T variant="small" color={bypass ? c.bg : 'ink2'} numberOfLines={1}>
        {bypass ? 'Original' : 'Compare'}
      </T>
    </Press>
  );
}

function BassCard() {
  const c = useTheme();
  const bassDb = useSound((s) => s.params.bassDb);
  const bassFreq = useSound((s) => s.params.bassFreq);
  const phantom = useSound((s) => s.params.phantom);
  const rumble = useSound((s) => s.params.rumble);
  const onSpeaker = useSound((s) => s.route.kind === 'speaker');

  return (
    <Card testID="sound-bass">
      <CardHeader kicker="Low end" title="Bass" detail="Drag the knob up for more weight. Its glow breathes with the kick drum." />
      <View style={styles.knob}>
        <BassKnob value={bassDb} onChange={(v) => updateSound({ bassDb: v })} />
      </View>
      <SliderRow title="Bass frequency" value={hz(bassFreq)} detail="Lower for deep sub, higher for a punchier kick">
        <Slider
          value={bassFreq}
          min={40}
          max={150}
          step={5}
          tickEvery={10}
          onChange={(v) => updateSound({ bassFreq: v })}
          label="Bass frequency"
          format={(v) => `${Math.round(v)} hertz`}
          testID="sound-bass-freq"
        />
      </SliderRow>
      <SliderRow
        title="Phantom bass"
        value={pct(phantom)}
        detail="Adds harmonics, so earbuds and phone speakers suggest bass they can't physically play">
        <Slider
          value={phantom}
          min={0}
          max={1}
          step={0.05}
          tickEvery={0.25}
          onChange={(v) => updateSound({ phantom: v })}
          label="Phantom bass"
          format={(v) => `${Math.round(v * 100)} percent`}
          testID="sound-phantom"
        />
      </SliderRow>
      {onSpeaker && phantom < SPEAKER_PHANTOM - 0.1 ? (
        <View style={[styles.tip, { backgroundColor: c.fill }]}>
          <Icon name="device-mobile-speaker" size={20} color={c.accent} />
          <T variant="small" color="ink2" style={styles.flex}>
            Phone speakers can&apos;t move much air. More phantom bass makes the low end audible.
          </T>
          <Button
            label="Try it"
            size="sm"
            variant="secondary"
            onPress={() => updateSound({ phantom: SPEAKER_PHANTOM })}
            testID="sound-speaker-tip"
          />
        </View>
      ) : null}
      <Divider />
      <ToggleRow
        icon="wave-sine"
        title="Rumble filter"
        detail="Removes sub-25 Hz energy you can't hear, so the boost goes where you can feel it"
        value={rumble}
        onValueChange={(v) => updateSound({ rumble: v })}
        testID="sound-rumble"
      />
    </Card>
  );
}

function Presets({ presetId }: { presetId: string | null }) {
  const preset = PRESETS.find((p) => p.id === presetId);
  return (
    <View style={styles.presets} testID="sound-preset-section">
      <View style={styles.presetsHead}>
        <T variant="label" color="ink4">
          Presets
        </T>
        <T variant="heading" numberOfLines={1} testID="sound-preset-name">
          {preset ? preset.name : 'Custom'}
        </T>
        <T variant="small" color="ink3" numberOfLines={2}>
          {preset ? preset.blurb : 'Your own sound. Tap a preset to start from one.'}
        </T>
      </View>
      <PresetStrip selectedId={presetId} />
    </View>
  );
}

function EqCard() {
  const params = useSound((s) => s.params);
  const bypass = useSound((s) => s.bypass);
  const flat = params.bands.every((b) => b === 0);
  return (
    <Card testID="sound-eq">
      <CardHeader
        kicker="10-band"
        title="Equaliser"
        detail="The curve is everything you hear together: bass, bands and treble."
        right={
          <Button
            label="Flatten"
            size="sm"
            variant="ghost"
            disabled={flat}
            onPress={() => updateSound({ bands: FLAT_SOUND.bands })}
            testID="sound-flatten"
          />
        }
      />
      <EqGraph params={params} muted={bypass || !params.enabled} onBand={setBand} />
    </Card>
  );
}

function ToneCard() {
  const treble = useSound((s) => s.params.trebleDb);
  const width = useSound((s) => s.params.width);
  const balance = useSound((s) => s.params.balance);
  return (
    <Card testID="sound-tone">
      <CardHeader kicker="Tone & space" title="Shape" />
      <SliderRow title="Treble" value={formatDb(treble)} detail="A gentle shelf above 7 kHz: more air and sparkle, or a softer top">
        <Slider
          value={treble}
          min={-6}
          max={6}
          step={0.5}
          origin={0}
          tickEvery={3}
          onChange={(v) => updateSound({ trebleDb: v })}
          label="Treble"
          format={formatDb}
          testID="sound-treble"
        />
      </SliderRow>
      <SliderRow title="Stereo width" value={widthLabel(width)} detail="Wider pulls instruments apart. Mono helps when you share one earbud.">
        <Slider
          value={width}
          min={0}
          max={2}
          step={0.05}
          origin={1}
          tickEvery={0.5}
          onChange={(v) => updateSound({ width: v })}
          label="Stereo width"
          format={widthLabel}
          testID="sound-width"
        />
      </SliderRow>
      <SliderRow title="Balance" value={balanceLabel(balance)}>
        <Slider
          value={balance}
          min={-1}
          max={1}
          step={0.05}
          origin={0}
          tickEvery={0.5}
          onChange={(v) => updateSound({ balance: v })}
          label="Left and right balance"
          format={balanceLabel}
          testID="sound-balance"
        />
      </SliderRow>
    </Card>
  );
}

function OutputCard() {
  const preamp = useSound((s) => s.params.preampDb);
  const auto = useSound((s) => s.params.autoHeadroom);
  const limiter = useSound((s) => s.params.limiter);
  const headroom = useSound((s) => s.headroomDb);
  const headroomNote = !auto
    ? 'Off: big boosts can clip and crackle on loud songs'
    : headroom < 0
      ? `Lowering the level by ${dbAmount(headroom)} so your boosts stay clean`
      : 'Lowers the level by just enough that boosts never clip';

  return (
    <Card testID="sound-output">
      <CardHeader kicker="Loudness & protection" title="Output" />
      <SliderRow title="Preamp" value={formatDb(preamp)} detail="The overall level going into the limiter">
        <Slider
          value={preamp}
          min={-12}
          max={6}
          step={0.5}
          origin={0}
          tickEvery={3}
          onChange={(v) => updateSound({ preampDb: v })}
          label="Preamp"
          format={formatDb}
          testID="sound-preamp"
        />
      </SliderRow>
      <Divider />
      <ToggleRow
        icon="shield-check"
        title="Auto headroom"
        detail={headroomNote}
        value={auto}
        onValueChange={(v) => updateSound({ autoHeadroom: v })}
        testID="sound-headroom"
      />
      <ToggleRow
        icon="lightning"
        title="Peak limiter"
        detail="Catches the loudest hits so heavy bass never distorts"
        value={limiter}
        onValueChange={(v) => updateSound({ limiter: v })}
        testID="sound-limiter"
      />
      {limiter ? <OutputMeters /> : null}
    </Card>
  );
}

function DevicesCard() {
  const c = useTheme();
  const route = useSound((s) => s.route);
  const perDevice = useSound((s) => s.perDevice);
  const profiles = useSound((s) => s.profiles);
  const others = useMemo(
    () =>
      Object.keys(profiles)
        .filter((k) => k !== route.key)
        .map(profileName)
        .sort(compareText),
    [profiles, route.key],
  );

  return (
    <Card testID="sound-devices">
      <View style={styles.device}>
        <View style={[styles.deviceIcon, { backgroundColor: withAlpha(c.accent, 0.14) }]}>
          <Icon name={routeIcon(route)} size={22} color={c.accent} weight="duotone" />
        </View>
        <View style={styles.flex}>
          <T variant="label" color="ink4">
            Playing through
          </T>
          <T variant="headline" numberOfLines={1} testID="sound-route">
            {route.name}
          </T>
        </View>
        <T variant="small" color="ink3">
          {ROUTE_KIND[route.kind]}
        </T>
      </View>
      <ToggleRow
        icon="sliders-horizontal"
        title="Sound per device"
        detail={
          perDevice
            ? 'Buds, speakers and your car each keep their own sound, switched automatically'
            : 'One sound for everything you plug in or pair'
        }
        value={perDevice}
        onValueChange={setPerDevice}
        testID="sound-per-device"
      />
      {perDevice && others.length ? (
        <T variant="small" color="ink4" testID="sound-profiles">
          {`Also remembered: ${others.join(', ')}`}
        </T>
      ) : null}
    </Card>
  );
}

function Footer() {
  const c = useTheme();
  const reset = () => {
    const { perDevice, route } = useSound.getState();
    confirm({
      title: 'Reset sound?',
      message: perDevice
        ? `${route.name} goes back to Thrum's signature sound. Other devices keep theirs.`
        : "Everything goes back to Thrum's signature sound.",
      confirmLabel: 'Reset',
      onConfirm: () => {
        resetSound();
        toast({ message: 'Back to the Thrum sound', icon: 'check', tone: 'success' });
      },
    });
  };
  return (
    <View style={styles.footer}>
      <Button label="Reset sound" icon="arrow-counter-clockwise" variant="ghost" size="sm" onPress={reset} testID="sound-reset" />
      <View style={styles.footnote}>
        <Icon name="waveform" size={14} color={c.ink4} />
        <T variant="small" color="ink4" style={styles.flex}>
          Shaped in 64-bit precision on your phone, then dithered for a clean, quiet output.
        </T>
      </View>
    </View>
  );
}

export default function Sound() {
  const c = useTheme();
  const { ref, y } = useScrollY();
  useScrollToTop(ref);
  const metrics = useHeaderMetrics();
  const bottom = useBottomChrome(true);
  const enabled = useSound((s) => s.params.enabled);
  const presetId = useSound((s) => matchPreset(s.params));
  const routeName = useSound((s) => s.route.name);
  const perDevice = useSound((s) => s.perDevice);
  const preset = PRESETS.find((p) => p.id === presetId);
  const subtitle = !enabled ? 'Off · the original sound' : preset ? `${preset.name} preset` : 'Your custom sound';

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <Animated.ScrollView ref={ref} showsVerticalScrollIndicator={false} testID="sound">
        <LargeHeader
          y={y}
          metrics={metrics}
          kicker={perDevice ? `Tuned for ${routeName}` : 'All outputs'}
          title="Sound"
          subtitle={subtitle}
          testID="sound-header"
        />
        <MasterBar />
        <View
          style={[styles.cards, enabled ? null : styles.off]}
          importantForAccessibility={enabled ? 'auto' : 'no-hide-descendants'}
          accessibilityElementsHidden={!enabled}>
          <BassCard />
          <Presets presetId={presetId} />
          <EqCard />
          <ToneCard />
          <OutputCard />
        </View>
        <View style={styles.devices}>
          <DevicesCard />
        </View>
        <Footer />
        <View style={{ height: bottom + space.xxl }} />
      </Animated.ScrollView>
      <TopBar y={y} title="Sound" collapseAt={metrics.collapseAt} right={<CompareButton />} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  cards: { gap: space.md },
  off: { opacity: 0.4, pointerEvents: 'none' },
  devices: { marginTop: space.md },
  master: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginHorizontal: space.page,
    marginBottom: space.md,
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  compare: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingHorizontal: space.md,
    marginRight: space.sm,
    borderRadius: radius.pill,
  },
  knob: { alignItems: 'center', paddingVertical: space.sm },
  sliderRow: { gap: 2 },
  sliderTop: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  tip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
  },
  presets: { gap: space.md, paddingVertical: space.sm },
  presetsHead: { gap: 2, paddingHorizontal: space.page },
  device: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  deviceIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  footer: { alignItems: 'center', gap: space.md, marginTop: space.xl, paddingHorizontal: space.page },
  footnote: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
