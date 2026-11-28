/**
 * Over-the-air JS updates (expo-updates + EAS Update, channel per build
 * profile). A release build checks on launch (app.json `checkAutomatically:
 * ON_LOAD`) and applies on the next start; this hook also checks when the app
 * comes back to the front, downloads quietly, and offers "Restart now".
 *
 * Fails soft: no network or no update server = nothing happens. Never runs in
 * development or on web (expo-updates is disabled there).
 */
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as Updates from 'expo-updates';

const MIN_GAP_MS = 30 * 60_000;

export function useOtaUpdate(): { ready: boolean; restart: () => void } {
  // expo-updates tracks the state itself: true once a new update is downloaded.
  const { isUpdatePending } = Updates.useUpdates();
  const lastCheck = useRef(0);

  useEffect(() => {
    if (!Updates.isEnabled || __DEV__) return;
    const check = async () => {
      const now = Date.now();
      if (now - lastCheck.current < MIN_GAP_MS) return;
      lastCheck.current = now;
      try {
        const r = await Updates.checkForUpdateAsync();
        if (r.isAvailable) await Updates.fetchUpdateAsync();
      } catch {
        // Offline or the update server is unreachable: try again next time.
      }
    };
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void check();
    });
    return () => sub.remove();
  }, []);

  const restart = useCallback(() => {
    Updates.reloadAsync().catch(() => {});
  }, []);

  return { ready: isUpdatePending, restart };
}

/** "1.0.0 · production · 3f2a91c" for the Me screen (helps support). */
export function versionLabel(appVersion: string | undefined): string {
  const parts = [appVersion ?? '?'];
  if (Updates.channel) parts.push(Updates.channel);
  if (Updates.updateId) parts.push(Updates.updateId.slice(0, 7));
  else if (Updates.isEmbeddedLaunch) parts.push('built-in');
  return parts.join(' · ');
}
