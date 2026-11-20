import { useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '../buttons';
import { Icon } from '../icon';
import { MenuItem, SheetHeader } from '../sheet';
import { formatCount } from '@/lib/format';
import { addToPlaylist, createPlaylist, MAX_PLAYLIST_NAME, renamePlaylist, useCollections } from '@/stores/collections';
import { toast } from '@/stores/toast';
import { closeSheet, openSheet } from '@/stores/ui';
import { fonts, radius, space, useTheme } from '@/theme';

export function AddToPlaylistSheet({ trackIds }: { trackIds: string[] }) {
  const c = useTheme();
  const playlists = useCollections((s) => s.playlists);
  const count = trackIds.length;
  return (
    <>
      <SheetHeader title="Add to playlist" subtitle={count === 1 ? '1 track' : `${count} tracks`} />
      <MenuItem
        icon="plus"
        label="New playlist"
        tone="accent"
        onPress={() => openSheet({ kind: 'new-playlist', trackIds })}
        testID="sheet-new-playlist"
      />
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled">
        {playlists.map((p) => {
          const have = new Set(p.trackIds);
          const all = trackIds.every((id) => have.has(id));
          return (
            <MenuItem
              key={p.id}
              icon="playlist"
              label={p.name}
              detail={formatCount(p.trackIds.length, 'track')}
              trailing={all ? <Icon name="check" size={18} color={c.accent} weight="bold" /> : undefined}
              onPress={() => {
                const added = addToPlaylist(p.id, trackIds);
                closeSheet();
                toast(
                  added
                    ? { message: `Added to ${p.name}`, icon: 'check', tone: 'success' }
                    : { message: `Already in ${p.name}`, icon: 'info' },
                );
              }}
            />
          );
        })}
      </ScrollView>
    </>
  );
}

type NameFormProps = {
  title: string;
  initial?: string;
  confirm: string;
  onSubmit: (name: string) => void;
};

function NameForm({ title, initial = '', confirm, onSubmit }: NameFormProps) {
  const c = useTheme();
  const [name, setName] = useState(initial);
  const clean = name.trim();
  const submit = () => {
    if (clean) onSubmit(clean);
  };
  return (
    <>
      <SheetHeader title={title} />
      <TextInput
        value={name}
        onChangeText={setName}
        autoFocus
        placeholder="Late-night drives"
        placeholderTextColor={c.ink4}
        maxLength={MAX_PLAYLIST_NAME}
        returnKeyType="done"
        onSubmitEditing={submit}
        selectionColor={c.accent}
        cursorColor={c.accent}
        accessibilityLabel="Playlist name"
        testID="playlist-name"
        style={[styles.input, { backgroundColor: c.fill, borderColor: c.lineStrong, color: c.ink }]}
      />
      <View style={styles.actions}>
        <Button label="Cancel" variant="ghost" onPress={closeSheet} />
        <Button label={confirm} onPress={submit} disabled={!clean} testID="playlist-submit" />
      </View>
    </>
  );
}

export function NewPlaylistSheet({ trackIds }: { trackIds: string[] }) {
  return (
    <NameForm
      title="New playlist"
      confirm="Create"
      onSubmit={(name) => {
        const p = createPlaylist(name, trackIds);
        if (!p) return;
        closeSheet();
        toast({
          message: trackIds.length ? `Created ${p.name} with ${formatCount(trackIds.length, 'track')}` : `Created ${p.name}`,
          icon: 'check',
          tone: 'success',
        });
      }}
    />
  );
}

export function RenamePlaylistSheet({ playlistId }: { playlistId: string }) {
  const current = useCollections((s) => s.playlists.find((p) => p.id === playlistId)?.name);
  if (current === undefined) return null;
  return (
    <NameForm
      title="Rename playlist"
      initial={current}
      confirm="Save"
      onSubmit={(name) => {
        renamePlaylist(playlistId, name);
        closeSheet();
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: { maxHeight: 360 },
  listContent: { paddingBottom: space.xs },
  input: {
    height: 54,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.lg,
    fontFamily: fonts.sansMedium,
    fontSize: 17,
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm, marginTop: space.lg },
});
