import { StyleSheet, View } from 'react-native';

import { Icon, type IconName } from '../icon';
import { MenuItem, SheetHeader } from '../sheet';
import { Switch } from '../switch';
import { T } from '../text';
import type { AlbumSort, TrackSort } from '@/lib/library';
import { useSettings } from '@/stores/settings';
import { closeSheet } from '@/stores/ui';
import { space, useTheme } from '@/theme';

export const TRACK_SORTS: { id: TrackSort; label: string; icon: IconName }[] = [
  { id: 'title', label: 'Title', icon: 'text-aa' },
  { id: 'artist', label: 'Artist', icon: 'microphone-stage' },
  { id: 'album', label: 'Album', icon: 'disc' },
  { id: 'added', label: 'Recently added', icon: 'calendar-blank' },
  { id: 'year', label: 'Year', icon: 'clock' },
  { id: 'duration', label: 'Length', icon: 'hourglass' },
  { id: 'plays', label: 'Most played', icon: 'fire' },
];

export const ALBUM_SORTS: { id: AlbumSort; label: string; icon: IconName }[] = [
  { id: 'title', label: 'Title', icon: 'text-aa' },
  { id: 'artist', label: 'Artist', icon: 'microphone-stage' },
  { id: 'year', label: 'Year', icon: 'clock' },
  { id: 'added', label: 'Recently added', icon: 'calendar-blank' },
];

export function SortSheet() {
  const c = useTheme();
  const section = useSettings((s) => s.section);
  const trackSort = useSettings((s) => s.trackSort);
  const desc = useSettings((s) => s.trackSortDesc);
  const albumSort = useSettings((s) => s.albumSort);
  const set = useSettings((s) => s.set);
  const check = <Icon name="check" size={18} color={c.accent} weight="bold" />;

  if (section === 'albums') {
    return (
      <>
        <SheetHeader title="Sort albums" />
        {ALBUM_SORTS.map((o) => (
          <MenuItem
            key={o.id}
            icon={o.icon}
            label={o.label}
            haptic="select"
            trailing={albumSort === o.id ? check : undefined}
            onPress={() => {
              set('albumSort', o.id);
              closeSheet();
            }}
          />
        ))}
      </>
    );
  }

  return (
    <>
      <SheetHeader title="Sort tracks" />
      {TRACK_SORTS.map((o) => (
        <MenuItem
          key={o.id}
          icon={o.icon}
          label={o.label}
          haptic="select"
          trailing={trackSort === o.id ? check : undefined}
          onPress={() => {
            set('trackSort', o.id);
            closeSheet();
          }}
        />
      ))}
      <View style={[styles.reverse, { borderTopColor: c.line }]}>
        <T variant="calloutMedium" style={styles.reverseLabel}>
          Reverse order
        </T>
        <Switch value={desc} label="Reverse order" onValueChange={(v) => set('trackSortDesc', v)} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  reverse: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: space.sm,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  reverseLabel: { flex: 1 },
});
