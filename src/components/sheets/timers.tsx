import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button, Chip } from '../buttons';
import { Icon } from '../icon';
import { Press } from '../press';
import { SheetHeader } from '../sheet';
import { Slider } from '../slider';
import { Switch } from '../switch';
import { T } from '../text';
import type { SleepMode } from '@/audio/native';
import { useSecondTicker } from '@/hooks/use-clock';
import { formatDuration } from '@/lib/format';
import { player, SPEEDS, usePlayer } from '@/stores/player';
import { useSettings } from '@/stores/settings';
import { toast } from '@/stores/toast';
import { closeSheet } from '@/stores/ui';
import { fonts, radius, space, useTheme } from '@/theme';

const MINUTES = [5, 15, 30, 45, 60, 90];
const FADES = [0, 10, 20, 45];

export function SleepSheet() {
  const c = useTheme();
  const sleep = usePlayer((s) => s.sleep);
  const fade = useSettings((s) => s.sleepFadeSec);
  const timed = sleep.mode === 'time' && sleep.endsAt !== null;
  const now = useSecondTicker(timed);
  const left = timed && sleep.endsAt ? Math.max(0, sleep.endsAt - now) : 0;

  const arm = async (minutes: number, mode: SleepMode) => {
    const ok = await player.setSleep(minutes, mode);
    closeSheet();
    toast(
      ok
        ? { message: mode === 'track' ? 'Stopping after this track' : `Stopping in ${minutes} min`, icon: 'timer' }
        : { message: "Couldn't set the sleep timer", icon: 'warning', tone: 'danger' },
    );
  };

  return (
    <>
      <SheetHeader
        title="Sleep timer"
        subtitle={fade ? `Fades out over the last ${fade} s, then stops` : 'Stops playback'}
      />
      {sleep.mode ? (
        <View style={[styles.active, { backgroundColor: c.fill, borderColor: c.line }]}>
          <View style={styles.activeText}>
            <T variant="label" color="ink3">
              {sleep.mode === 'track' ? 'Stopping' : 'Stopping in'}
            </T>
            {sleep.mode === 'track' ? (
              <T variant="heading">After this track</T>
            ) : (
              <T style={[styles.countdown, { color: c.accent }]} accessibilityLiveRegion="polite" tabular>
                {formatDuration(left)}
              </T>
            )}
          </View>
          <View style={styles.activeActions}>
            {sleep.mode === 'time' ? (
              <Button
                label="+10 min"
                size="sm"
                variant="secondary"
                onPress={() => void arm(Math.ceil(left / 60_000) + 10, 'time')}
              />
            ) : null}
            <Button
              label="Cancel"
              size="sm"
              variant="danger"
              onPress={() => {
                void player.cancelSleep();
                closeSheet();
                toast({ message: 'Sleep timer off', icon: 'timer' });
              }}
            />
          </View>
        </View>
      ) : null}
      <View style={styles.grid}>
        {MINUTES.map((m) => (
          <Press
            key={m}
            onPress={() => void arm(m, 'time')}
            haptic="select"
            scale={0.95}
            accessibilityLabel={`${m} minutes`}
            testID={`sleep-${m}`}
            style={[styles.tile, { backgroundColor: c.fill, borderColor: c.line }]}>
            <T variant="title">
              {m}
            </T>
            <T variant="label" color="ink3">
              min
            </T>
          </Press>
        ))}
      </View>
      <Press
        onPress={() => void arm(0, 'track')}
        haptic="select"
        scale={0.98}
        accessibilityLabel="Stop at the end of this track"
        accessibilityState={{ selected: sleep.mode === 'track' }}
        style={[
          styles.endTrack,
          { backgroundColor: sleep.mode === 'track' ? c.accent : c.fill, borderColor: c.line },
        ]}>
        <Icon name="music-note" size={18} color={sleep.mode === 'track' ? c.onAccent : c.ink} weight="fill" />
        <T variant="calloutMedium" color={sleep.mode === 'track' ? 'onAccent' : 'ink'}>
          End of this track
        </T>
      </Press>
      <T variant="label" color="ink3" style={styles.kicker}>
        Fade out
      </T>
      <View style={styles.chips}>
        {FADES.map((f) => (
          <Chip
            key={f}
            label={f ? `${f} s` : 'Off'}
            selected={fade === f}
            onPress={() => useSettings.getState().set('sleepFadeSec', f)}
          />
        ))}
      </View>
    </>
  );
}

const fmtSpeed = (v: number) => `${Math.round(v * 100) / 100}×`;

export function SpeedSheet() {
  const c = useTheme();
  const speed = usePlayer((s) => s.speed);
  const pitch = usePlayer((s) => s.pitch);
  const skipSilence = useSettings((s) => s.skipSilence);
  const [vinyl, setVinyl] = useState(() => pitch !== 1 && Math.abs(pitch - speed) < 0.001);

  const preset = (s: number, v: boolean) => {
    setVinyl(v);
    player.setSpeed(s, v);
  };

  return (
    <>
      <SheetHeader title="Speed & pitch" subtitle={vinyl ? 'Vinyl: pitch follows speed' : 'Pitch stays natural'} />
      <View style={styles.speedValue}>
        <T style={[styles.bigValue, { color: speed === 1 ? c.ink : c.accent }]} tabular>
          {fmtSpeed(speed)}
        </T>
        {speed !== 1 ? <Button label="Reset" size="sm" variant="ghost" icon="arrow-counter-clockwise" onPress={() => preset(1, vinyl)} /> : null}
      </View>
      <Slider
        value={speed}
        min={0.5}
        max={2}
        step={0.05}
        detent={1}
        tickEvery={0.25}
        label="Playback speed"
        format={fmtSpeed}
        onChange={(v) => player.setSpeed(v, vinyl)}
        testID="speed-slider"
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.speedScroll}
        contentContainerStyle={styles.speedChips}>
        {SPEEDS.map((s) => (
          <Chip key={s} size="sm" label={fmtSpeed(s)} selected={Math.abs(speed - s) < 0.001} onPress={() => player.setSpeed(s, vinyl)} />
        ))}
      </ScrollView>
      <T variant="label" color="ink3" style={styles.kicker}>
        Quick moods
      </T>
      <View style={styles.chips}>
        <Chip label="Slowed" icon="moon" iconWeight="fill" selected={vinyl && speed === 0.85} onPress={() => preset(0.85, true)} />
        <Chip label="Sped up" icon="lightning" iconWeight="fill" selected={vinyl && speed === 1.25} onPress={() => preset(1.25, true)} />
        <Chip label="Podcast pace" icon="microphone-stage" selected={!vinyl && speed === 1.5} onPress={() => preset(1.5, false)} />
      </View>
      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <T variant="calloutMedium">Vinyl mode</T>
          <T variant="small" color="ink3">
            Pitch rises and falls with speed, like a turntable
          </T>
        </View>
        <Switch
          value={vinyl}
          label="Vinyl mode"
          onValueChange={(v) => {
            setVinyl(v);
            player.setSpeed(speed, v);
          }}
        />
      </View>
      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <T variant="calloutMedium">Skip silence</T>
          <T variant="small" color="ink3">
            Trims quiet gaps between and inside tracks
          </T>
        </View>
        <Switch value={skipSilence} label="Skip silence" onValueChange={(v) => useSettings.getState().set('skipSilence', v)} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  active: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: space.lg,
  },
  activeText: { flex: 1, gap: 2 },
  activeActions: { flexDirection: 'row', gap: space.sm },
  countdown: { fontFamily: fonts.mono, fontSize: 34, lineHeight: 40, letterSpacing: -0.5 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: {
    flexBasis: '31%',
    flexGrow: 1,
    height: 76,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  endTrack: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    height: 52,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: space.sm,
  },
  kicker: { marginTop: space.xl, marginBottom: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  speedValue: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 56 },
  bigValue: { fontFamily: fonts.mono, fontSize: 44, lineHeight: 52, letterSpacing: -1 },
  speedScroll: { marginHorizontal: -space.page, marginTop: space.xs },
  speedChips: { gap: space.sm, paddingHorizontal: space.page },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.lg },
  switchText: { flex: 1, gap: 2 },
});
