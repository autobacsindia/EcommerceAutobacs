/**
 * Wires the HTTP core (http.ts) to the phone: base URL from config, tokens in
 * SecureStore, PDF downloads through expo-file-system.
 *
 * Auth: the app signs in with the existing staff login (POST /auth/login, email
 * or company username). If the server returns a Bearer pair it is kept in
 * SecureStore and sent as `Authorization: Bearer`; today the server answers
 * with httpOnly cookies, which React Native's native cookie jar keeps — the app
 * then remembers only "signed in" (also in SecureStore). Either way, a dead
 * session ends in a 401 → refresh once → Login screen.
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { createHttp, type TokenPair, type TokenStore } from './http';

/**
 * The API base URL: `EXPO_PUBLIC_API_URL` (dev/staging) or `extra.apiUrl` in
 * app.json. No hard-coded fallback — a build without one fails loudly at
 * start-up rather than talking to the wrong server.
 */
function resolveApiUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  const fromConfig = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl;
  const url = (fromEnv || fromConfig || '').replace(/\/+$/, '');
  if (!url) throw new Error('Autobacs Team: set EXPO_PUBLIC_API_URL or expo.extra.apiUrl');
  return url;
}

export const API_URL = resolveApiUrl();

const KEY = 'autobacs-team.session';

/** SecureStore on the phone; localStorage on Expo web (a preview surface only). */
const secureTokens: TokenStore = {
  async load() {
    const raw =
      Platform.OS === 'web' ? globalThis.localStorage?.getItem(KEY) ?? null : await SecureStore.getItemAsync(KEY);
    if (!raw) return { accessToken: null, refreshToken: null, signedIn: false };
    const p = JSON.parse(raw) as Partial<TokenPair>;
    return { accessToken: p.accessToken ?? null, refreshToken: p.refreshToken ?? null, signedIn: !!p.signedIn };
  },
  async save(pair) {
    const empty = !pair.signedIn && !pair.accessToken;
    if (Platform.OS === 'web') {
      if (empty) globalThis.localStorage?.removeItem(KEY);
      else globalThis.localStorage?.setItem(KEY, JSON.stringify(pair));
      return;
    }
    if (empty) await SecureStore.deleteItemAsync(KEY);
    else await SecureStore.setItemAsync(KEY, JSON.stringify(pair));
  },
};

let signedOutHandler: (() => void) | null = null;

/** The session provider registers this so a dead session returns to Login. */
export function setSignedOutHandler(fn: (() => void) | null): void {
  signedOutHandler = fn;
}

export const http = createHttp({
  baseUrl: API_URL,
  fetch: (...args) => fetch(...args),
  tokens: secureTokens,
  onSignedOut: () => signedOutHandler?.(),
});
