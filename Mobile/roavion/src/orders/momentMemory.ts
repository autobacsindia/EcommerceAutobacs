/**
 * Play-once memory for order moments: the picture animates the first time this phone
 * sees a given update of an order, and shows the still final picture after that.
 *
 * Stored per order (the update's signature, from momentSignature) in the same
 * on-device storage the app already uses for its other small prefs (SecureStore; the
 * browser's localStorage when run on the web). Losing it is harmless — the picture
 * just plays again — so every failure falls back to "play".
 */
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { memoryKey } from './momentParse';

async function read(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return globalThis.localStorage?.getItem(key) ?? null;
  return SecureStore.getItemAsync(key);
}

async function write(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export type PlayState = 'pending' | 'play' | 'still';

/**
 * Decides once per (order, update): `pending` while storage is read (the scene box
 * keeps its size, so nothing jumps), then `play` or `still`. When it decides `play`
 * it records the update straight away, so leaving mid-animation still counts as seen.
 */
export function usePlayOnce(orderId: string, signature: string): PlayState {
  const [state, setState] = useState<{ sig: string; play: PlayState }>({ sig: '', play: 'pending' });

  useEffect(() => {
    let alive = true;
    const key = memoryKey(orderId);
    read(key)
      .catch(() => null)
      .then((seen) => {
        if (!alive) return;
        const play: PlayState = seen === signature ? 'still' : 'play';
        setState({ sig: signature, play });
        if (play === 'play') write(key, signature).catch(() => {});
      });
    return () => {
      alive = false;
    };
  }, [orderId, signature]);

  return state.sig === signature ? state.play : 'pending';
}
