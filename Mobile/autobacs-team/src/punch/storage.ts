/**
 * Phone storage for the punch queue: a JSON file per key in the app's private
 * documents folder (not the cache, which the OS may purge while a punch waits),
 * and a private folder for queued face frames. Expo web (preview only) uses
 * localStorage and keeps no frames.
 */
import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import type { Frame } from '../api/types';
import type { JsonStore } from './queue';

const isWeb = Platform.OS === 'web';

export const fileStore: JsonStore = {
  async read<T>(key: string): Promise<T | null> {
    try {
      if (isWeb) {
        const raw = globalThis.localStorage?.getItem(`autobacs-team.${key}`);
        return raw ? (JSON.parse(raw) as T) : null;
      }
      const f = new File(Paths.document, `${key}.json`);
      if (!f.exists) return null;
      return JSON.parse(await f.text()) as T;
    } catch {
      return null; // a corrupt file must not stop the app; the server is the record
    }
  },
  async write(key: string, value: unknown): Promise<void> {
    const raw = JSON.stringify(value);
    if (isWeb) {
      globalThis.localStorage?.setItem(`autobacs-team.${key}`, raw);
      return;
    }
    const f = new File(Paths.document, `${key}.json`);
    if (!f.exists) f.create();
    f.write(raw);
  },
};

function framesDir(): Directory {
  const d = new Directory(Paths.document, 'punch-frames');
  if (!d.exists) d.create({ intermediates: true });
  return d;
}

/** Move freshly captured frames out of the cache so they survive until sent. */
export function keepFramesForQueue(frames: Frame[]): Frame[] {
  if (isWeb) return frames;
  const dir = framesDir();
  return frames.map((fr) => {
    const f = new File(fr.uri);
    f.move(dir);
    return { uri: f.uri, mimeType: fr.mimeType };
  });
}

/** Delete frames from the phone (after upload, refusal, expiry or cancel). */
export async function deleteFrames(frames: Frame[]): Promise<void> {
  if (isWeb) return;
  for (const fr of frames) {
    try {
      const f = new File(fr.uri);
      if (f.exists) f.delete();
    } catch {
      // Best effort; the startup sweep below catches anything left.
    }
  }
}

/** Remove frames no queued punch refers to (e.g. the app died mid-capture). */
export async function sweepOrphanFrames(keep: Set<string>): Promise<void> {
  if (isWeb) return;
  try {
    for (const entry of framesDir().list()) {
      if (entry instanceof File && !keep.has(entry.uri)) entry.delete();
    }
  } catch {
    /* best effort */
  }
}

/** Download a file with auth headers into the cache; returns its uri. */
export async function downloadToCache(url: string, headers: Record<string, string>, fileName: string): Promise<string> {
  const dest = new File(Paths.cache, fileName);
  if (dest.exists) dest.delete();
  const out = await File.downloadFileAsync(url, dest, { headers });
  return out.uri;
}
