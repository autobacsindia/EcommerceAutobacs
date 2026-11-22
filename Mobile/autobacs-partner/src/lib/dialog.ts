/**
 * Alert.alert is a no-op on react-native-web, so the web preview would silently
 * skip every confirmation. These wrap it: native dialog on phones, the
 * browser's confirm/alert on web.
 */
import { Alert, Platform } from 'react-native';

export function notify(title: string, message?: string) {
  if (Platform.OS === 'web') globalThis.alert?.([title, message].filter(Boolean).join('\n\n'));
  else Alert.alert(title, message);
}

export function confirm(opts: { title: string; message?: string; ok: string; destructive?: boolean }): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(globalThis.confirm?.([opts.title, opts.message].filter(Boolean).join('\n\n')) ?? false);
  }
  return new Promise((resolve) => {
    Alert.alert(opts.title, opts.message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: opts.ok, style: opts.destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}
