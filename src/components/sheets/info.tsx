import { ScrollView, StyleSheet, View } from 'react-native';

import { Cover } from '../cover';
import { SheetHeader } from '../sheet';
import { T } from '../text';
import { useTags } from '@/audio/tags';
import { useClock } from '@/hooks/use-clock';
import { camelot, energyLabel, keyName, tempoLabel } from '@/lib/features';
import { formatBytes, formatCount, formatDuration, formatRelative, formatShortDate, formatTotalDuration, qualityLabel } from '@/lib/format';
import { useFeatures } from '@/stores/features';
import { useHistory } from '@/stores/history';
import { useLibrary } from '@/stores/library';
import { radius, space, useTheme } from '@/theme';

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <View style={styles.row}>
      <T variant="callout" color="ink3" style={styles.rowLabel}>
        {label}
      </T>
      <T variant="calloutMedium" style={styles.rowValue} selectable>
        {value}
      </T>
    </View>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  const c = useTheme();
  const v = Math.min(1, Math.max(0, value));
  return (
    <View style={styles.meter} accessible accessibilityLabel={`${label} ${Math.round(v * 100)} percent`}>
      <T variant="label" color="ink3" style={styles.meterLabel}>
        {label}
      </T>
      <View style={[styles.meterTrack, { backgroundColor: c.fillStrong }]}>
        <View style={[styles.meterFill, { width: `${Math.max(2, v * 100)}%`, backgroundColor: c.accent }]} />
      </View>
      <T variant="mono" color="ink2" style={styles.meterValue} tabular>
        {Math.round(v * 100)}
      </T>
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  const c = useTheme();
  return (
    <View style={[styles.stat, { backgroundColor: c.fill, borderColor: c.line }]}>
      <T variant="title" numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </T>
      <T variant="label" color="ink3" numberOfLines={1}>
        {label}
      </T>
    </View>
  );
}

export function TrackInfoSheet({ trackId }: { trackId: string }) {
  const track = useLibrary((s) => s.lib.byId.get(trackId));
  const f = useFeatures((s) => s.map.get(trackId));
  const failed = useFeatures((s) => s.failed.has(trackId));
  const stat = useHistory((s) => s.stats.get(trackId));
  const tags = useTags(trackId);
  const now = useClock();
  const c = useTheme();
  if (!track) return null;

  const q = qualityLabel(track, tags);
  const format = [q.codec, q.detail].filter(Boolean).join(' · ') + (q.hiRes ? ' · Hi-Res' : '');
  const channels = tags?.channels ? (tags.channels === 1 ? 'Mono' : tags.channels === 2 ? 'Stereo' : `${tags.channels} channels`) : null;
  const gain = tags?.replayGainTrackDb != null ? `${tags.replayGainTrackDb > 0 ? '+' : ''}${tags.replayGainTrackDb.toFixed(1)} dB` : null;
  const key = f ? keyName(f.key, f.mode) : '';

  return (
    <>
      <SheetHeader
        leading={<Cover albumId={track.albumId} trackId={track.id} label={track.album} size={52} rounded={10} />}
        title={track.title}
        subtitle={track.artist}
      />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {f ? (
          <>
            <View style={styles.stats}>
              <Stat value={f.bpm > 0 ? String(Math.round(f.bpm)) : '—'} label={tempoLabel(f.bpm) || 'BPM'} />
              <Stat value={camelot(f.key, f.mode) || '—'} label={key || 'Key'} />
              <Stat value={Number.isFinite(f.loudnessLufs) ? f.loudnessLufs.toFixed(1) : '—'} label="LUFS" />
            </View>
            <T variant="label" color="ink3" style={styles.kicker}>
              {`Sound fingerprint · ${energyLabel(f.energy).toLowerCase()}`}
            </T>
            <View style={styles.meters}>
              <Meter label="Energy" value={f.energy} />
              <Meter label="Bass" value={f.bass} />
              <Meter label="Sub-bass" value={f.subBass} />
              <Meter label="Dance" value={f.danceability} />
              <Meter label="Mood" value={f.valence} />
              <Meter label="Bright" value={f.brightness} />
              <Meter label="Acoustic" value={f.acousticness} />
              <Meter label="Dynamics" value={f.dynamics} />
            </View>
          </>
        ) : (
          <View style={[styles.pending, { borderColor: c.lineStrong }]}>
            <T variant="callout" color="ink3">
              {failed ? "Thrum couldn't analyse this file's sound." : 'Sound analysis is still working on this one.'}
            </T>
          </View>
        )}

        <T variant="label" color="ink3" style={styles.kicker}>
          File
        </T>
        <Row label="Format" value={tags === undefined ? 'Reading…' : format} />
        <Row label="Channels" value={channels} />
        <Row label="Length" value={formatDuration(track.durationMs)} />
        <Row label="Size" value={track.size > 0 ? formatBytes(track.size) : null} />
        <Row label="ReplayGain" value={gain} />
        <Row label="Album" value={track.album} />
        <Row label="Genre" value={track.genre} />
        <Row label="Year" value={track.year ? String(track.year) : null} />
        <Row label="Track" value={track.trackNo ? (track.discNo ? `${track.trackNo} · disc ${track.discNo}` : String(track.trackNo)) : null} />
        <Row label="Added" value={formatShortDate(track.dateAdded, now)} />
        <Row label="Location" value={`${track.folder}${track.fileName}`} />

        <T variant="label" color="ink3" style={styles.kicker}>
          You
        </T>
        {stat && (stat.plays > 0 || stat.skips > 0) ? (
          <>
            <Row label="Plays" value={formatCount(stat.plays, 'play')} />
            <Row label="Skips" value={stat.skips ? formatCount(stat.skips, 'skip') : 'Never skipped'} />
            <Row label="Listened" value={formatTotalDuration(stat.totalMs)} />
            <Row label="Last played" value={stat.lastPlayedAt ? formatRelative(stat.lastPlayedAt, now) : null} />
            <Row label="First played" value={stat.firstPlayedAt ? formatShortDate(stat.firstPlayedAt, now) : null} />
          </>
        ) : (
          <T variant="callout" color="ink3">
            Not played yet. Go on, give it a spin.
          </T>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  content: { paddingBottom: space.lg },
  stats: { flexDirection: 'row', gap: space.sm },
  stat: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: space.md,
    paddingHorizontal: space.xs,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  kicker: { marginTop: space.xl, marginBottom: space.sm },
  meters: { gap: 10 },
  meter: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  meterLabel: { width: 74 },
  meterTrack: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  meterFill: { height: '100%', borderRadius: 3 },
  meterValue: { width: 28, textAlign: 'right' },
  pending: { padding: space.lg, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderStyle: 'dashed' },
  row: { flexDirection: 'row', gap: space.md, paddingVertical: 7 },
  rowLabel: { width: 96 },
  rowValue: { flex: 1, textAlign: 'right' },
});
