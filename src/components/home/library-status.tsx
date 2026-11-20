import { ActivityIndicator, Linking, StyleSheet, View } from 'react-native';

import { Button } from '../buttons';
import { Card } from '../card';
import { Icon, type IconName } from '../icon';
import { go } from '../nav';
import { T } from '../text';
import { requestPermission, rescanLibrary, useLibrary } from '@/stores/library';
import { useSettings } from '@/stores/settings';
import { radius, space, useTheme } from '@/theme';

type Action = { label: string; icon?: IconName; onPress: () => void; variant?: 'primary' | 'secondary' };

function StatusCard({
  icon,
  title,
  body,
  actions,
  busy,
  testID,
}: {
  icon: IconName;
  title: string;
  body: string;
  actions?: Action[];
  busy?: boolean;
  testID: string;
}) {
  const c = useTheme();
  return (
    <Card testID={testID}>
      <View style={styles.top}>
        <View style={[styles.badge, { backgroundColor: c.fill, borderColor: c.line }]}>
          {busy ? <ActivityIndicator color={c.accent} /> : <Icon name={icon} size={22} color={c.accent} weight="duotone" />}
        </View>
        <View style={styles.text}>
          <T variant="headline">{title}</T>
          <T variant="callout" color="ink3">
            {body}
          </T>
        </View>
      </View>
      {actions?.length ? (
        <View style={styles.actions}>
          {actions.map((a) => (
            <Button
              key={a.label}
              label={a.label}
              icon={a.icon}
              size="sm"
              variant={a.variant ?? 'primary'}
              onPress={a.onPress}
              testID={`${testID}-${a.label.toLowerCase().replace(/\s+/g, '-')}`}
            />
          ))}
        </View>
      ) : null}
    </Card>
  );
}

/** What Home shows instead of (or above) recommendations while the library isn't usable yet. */
export function LibraryStatusCard() {
  const status = useLibrary((s) => s.status);
  const count = useLibrary((s) => s.lib.tracks.length);
  const error = useLibrary((s) => s.error);
  const blocked = useLibrary((s) => s.permission?.status === 'denied' && s.permission.canAskAgain === false);
  const minSec = useSettings((s) => s.minDurationSec);

  if (status === 'needs-permission') {
    return blocked ? (
      <StatusCard
        icon="lock"
        title="Music access is off"
        body="Android won't ask again. Open Settings › Permissions › Music and audio, choose Allow, then come back."
        actions={[{ label: 'Open settings', icon: 'gear-six', onPress: () => void Linking.openSettings() }]}
        testID="status-blocked"
      />
    ) : (
      <StatusCard
        icon="music-notes"
        title="Let Thrum find your music"
        body="Thrum plays the songs already on your phone. Nothing is uploaded, ever."
        actions={[{ label: 'Allow access', icon: 'check', onPress: () => void requestPermission() }]}
        testID="status-permission"
      />
    );
  }
  if (status === 'scanning' && count === 0) {
    return (
      <StatusCard
        icon="music-notes"
        busy
        title="Finding your music"
        body="Reading your library. Big collections take a few seconds the first time."
        testID="status-scanning"
      />
    );
  }
  if (status === 'error') {
    return (
      <StatusCard
        icon="warning"
        title="Couldn't read your music"
        body={error ? `Android said: ${error}` : 'Something went wrong while scanning.'}
        actions={[{ label: 'Try again', icon: 'arrows-clockwise', onPress: () => void rescanLibrary() }]}
        testID="status-error"
      />
    );
  }
  if (status === 'ready' && count === 0) {
    return (
      <StatusCard
        icon="file-audio"
        title="No songs yet"
        body={`Copy music into your phone's Music or Download folder, then scan again. Files shorter than ${minSec} s are skipped.`}
        actions={[
          { label: 'Scan again', icon: 'arrows-clockwise', onPress: () => void rescanLibrary() },
          { label: 'Settings', icon: 'gear-six', variant: 'secondary', onPress: () => go('/settings') },
        ]}
        testID="status-empty"
      />
    );
  }
  return null;
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  badge: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: space.xs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
