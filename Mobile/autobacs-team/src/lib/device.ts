/**
 * Per-install device id (sent with punches so HR can approve/revoke a phone)
 * and fresh client ids for idempotent writes.
 */
import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const KEY = 'autobacs-team.deviceId';
let cached: string | null = null;

export function newClientId(): string {
  // UUID v4: 36 chars of [0-9a-f-], inside the server's 8–64 [A-Za-z0-9_-] rule.
  return Crypto.randomUUID();
}

export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  try {
    const stored =
      Platform.OS === 'web' ? globalThis.localStorage?.getItem(KEY) ?? null : await SecureStore.getItemAsync(KEY);
    if (stored) return (cached = stored);
  } catch {
    /* fall through to a new id */
  }
  const id = newClientId();
  cached = id;
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(KEY, id);
    else await SecureStore.setItemAsync(KEY, id);
  } catch {
    /* in-memory for this launch */
  }
  return id;
}

export const platform = (): 'ios' | 'android' | 'web' =>
  Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web';
