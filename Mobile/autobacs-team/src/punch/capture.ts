/**
 * Phone-side capture for a punch: the location reading and the face frames.
 * The phone only REPORTS (position, accuracy, mock flag, frames); the server
 * decides geofence, liveness and match.
 */
import * as Location from 'expo-location';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';
import type { Frame } from '../api/types';

export type Reading = { lat: number; lng: number; accuracyM: number | null; mocked: boolean };

export type LocationResult = { ok: true; reading: Reading } | { ok: false; reason: 'denied' | 'off' | 'failed' };

export async function readLocation(): Promise<LocationResult> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (perm.status !== 'granted') return { ok: false, reason: 'denied' };
  if (!(await Location.hasServicesEnabledAsync())) return { ok: false, reason: 'off' };
  try {
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    return {
      ok: true,
      reading: {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracyM: pos.coords.accuracy ?? null,
        // Android sets this when a fake-GPS app supplies the position.
        mocked: pos.mocked === true,
      },
    };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/**
 * Shrink a camera picture to a 720 px wide JPEG (well under the server's
 * 1.5 MB limit) and delete the full-size original straight away.
 */
export async function shrinkFrame(uri: string): Promise<Frame> {
  const img = await ImageManipulator.manipulate(uri).resize({ width: 720 }).renderAsync();
  const out = await img.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });
  if (Platform.OS !== 'web') {
    try {
      const original = new File(uri);
      if (original.exists) original.delete();
    } catch {
      /* the cache is swept by the OS anyway */
    }
  }
  return { uri: out.uri, mimeType: 'image/jpeg' };
}
