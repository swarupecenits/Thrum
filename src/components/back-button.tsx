import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

import { IconButton } from './buttons';

/** Back when there is history (deep links may land on a detail screen), otherwise home. */
export function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/** `onArt`: a soft dark disc so the arrow stays readable over bright artwork. */
export function BackButton({ onArt, testID = 'back' }: { onArt?: boolean; testID?: string }) {
  return (
    <IconButton
      icon="arrow-left"
      label="Back"
      onPress={goBack}
      weight="bold"
      iconSize={22}
      style={onArt ? styles.disc : undefined}
      testID={testID}
    />
  );
}

const styles = StyleSheet.create({
  disc: { backgroundColor: 'rgba(0,0,0,0.22)' },
});
