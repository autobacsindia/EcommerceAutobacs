/**
 * Read a bundled .glb for the showroom, as base64 for injecting into the WebView.
 * (A WebView page cannot read the app's own files, so the bytes are handed in.)
 * Web previews use modelFile.web.ts.
 */
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';

export async function readModelBase64(asset: number): Promise<string> {
  const a = Asset.fromModule(asset);
  await a.downloadAsync();
  if (!a.localUri) throw new Error('model file not available on this phone');
  return new File(a.localUri).base64();
}
