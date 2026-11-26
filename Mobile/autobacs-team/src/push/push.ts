/**
 * Phone notifications (expo-notifications + Expo push). Everything here fails
 * soft: no permission, an emulator, no FCM setup or no network just means no
 * notifications — the app works the same.
 *
 *   registerForPush()   after sign-in and on every launch: asks once, gets this
 *                       install's Expo token, PUT /hr/me/push-token
 *   unregisterPush()    before sign-out: DELETE /hr/me/push-token, so the next
 *                       person on a shared phone does not get your payslip push
 *   usePushTaps()       a tap opens the matching screen (routes.ts allow-list)
 */
import { useEffect } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
// Imported from its own module: the package index re-exports it via `export *`,
// which the lint import plugin cannot follow.
import { AndroidImportance } from 'expo-notifications/build/NotificationChannelManager.types';
import { router } from 'expo-router';
import { api } from '../api';
import { getDeviceId } from '../lib/device';
import { pushTarget } from './routes';

let handlerSet = false;

/** Show notifications while the app is open too (banner + list, no badge count). */
export function setForegroundHandler(): void {
  if (handlerSet || Platform.OS === 'web') return;
  handlerSet = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

function projectId(): string | undefined {
  return (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;
}

export type PushResult = 'registered' | 'unsupported' | 'denied' | 'failed';

export async function registerForPush(): Promise<PushResult> {
  if (Platform.OS === 'web' || !Device.isDevice) return 'unsupported';
  try {
    if (Platform.OS === 'android') {
      // The channel the server's messages use (channelId 'default').
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Leave, overtime and pay',
        importance: AndroidImportance.HIGH,
      });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return 'denied';
    const id = projectId();
    if (!id) return 'failed';
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    await api.registerPush({ deviceId: await getDeviceId(), token, platform: Platform.OS === 'ios' ? 'ios' : 'android' });
    return 'registered';
  } catch {
    return 'failed';
  }
}

export async function unregisterPush(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await api.unregisterPush(await getDeviceId());
  } catch {
    // Offline sign-out: the server drops the token when it moves to the next
    // person or Expo reports the device gone.
  }
}

/** Opens the right screen when a notification is tapped (also a cold start from one). */
export function usePushTaps(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || Platform.OS === 'web') return;
    const open = (r: Notifications.NotificationResponse | null) => {
      const to = r ? pushTarget(r.notification.request.content.data) : null;
      if (to) router.push(to);
    };
    let seen = '';
    // A tap that launched the app before this screen mounted.
    Notifications.getLastNotificationResponseAsync()
      .then((r) => {
        if (r && r.notification.request.identifier !== seen) {
          seen = r.notification.request.identifier;
          open(r);
          void Notifications.clearLastNotificationResponseAsync?.();
        }
      })
      .catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      seen = r.notification.request.identifier;
      open(r);
    });
    return () => sub.remove();
  }, [enabled]);
}
