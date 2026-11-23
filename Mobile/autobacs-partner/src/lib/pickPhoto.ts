/**
 * Camera or gallery → a LocalFile ready to upload. Photos are re-encoded to
 * JPEG at 0.7 quality by the picker, which keeps a 12 MP phone photo well under
 * typical upload limits without a separate resize step.
 */
import { Alert, Platform } from 'react-native';
import { Asset } from 'expo-asset';
import { IS_MOCK } from '../api';
import { notify } from './dialog';
import * as ImagePicker from 'expo-image-picker';
import type { LocalFile } from '../api';

export type PhotoSource = 'camera' | 'library';

export async function pickPhoto(source: PhotoSource, opts: { multiple?: number } = {}): Promise<LocalFile[]> {
  // Dev mock on web only: the browser preview cannot drive a file dialog, so
  // hand back a bundled sample so the upload flow can be exercised end to end.
  if (IS_MOCK && Platform.OS === 'web') {
    const asset = Asset.fromModule(require('../../assets/badge.png'));
    return [{ uri: asset.uri, name: 'sample.png', mimeType: 'image/png' }];
  }
  const perm =
    source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    notify(source === 'camera' ? 'Camera is off' : 'Photos are off', 'Allow access in your phone Settings → Autobacs Partner to add photos.');
    return [];
  }
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    quality: 0.7,
    allowsMultipleSelection: source === 'library' && (opts.multiple ?? 1) > 1,
    selectionLimit: opts.multiple ?? 1,
  };
  const res = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (res.canceled) return [];
  return res.assets.map((a, i) => ({
    uri: a.uri,
    name: a.fileName || `photo-${Date.now()}-${i}.jpg`,
    mimeType: a.mimeType || 'image/jpeg',
  }));
}

/** Ask camera-or-gallery. On web there is no camera prompt, so go straight to files. */
export function choosePhotoSource(): Promise<PhotoSource | null> {
  if (Platform.OS === 'web') return Promise.resolve('library');
  return new Promise((resolve) => {
    Alert.alert('Add a photo', undefined, [
      { text: 'Take photo', onPress: () => resolve('camera') },
      { text: 'Choose from gallery', onPress: () => resolve('library') },
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
    ]);
  });
}
