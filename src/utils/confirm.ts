import { Alert, Platform } from 'react-native';

type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel: string;
  /** Red confirm button for actions that can't be undone. */
  destructive?: boolean;
  onConfirm: () => void;
};

/** A native two-button dialog; window.confirm on web, where Alert does nothing. */
export function confirm({ title, message, confirmLabel, destructive = true, onConfirm }: ConfirmOptions) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(
    title,
    message,
    [
      { text: 'Cancel', style: 'cancel' },
      { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: onConfirm },
    ],
    { cancelable: true },
  );
}
