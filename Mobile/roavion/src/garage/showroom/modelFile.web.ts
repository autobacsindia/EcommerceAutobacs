/** Web preview: the bundled .glb is fetched from the dev server and posted to the iframe as bytes. */
import { Asset } from 'expo-asset';

export async function readModelBytes(asset: number): Promise<ArrayBuffer> {
  const res = await fetch(Asset.fromModule(asset).uri);
  if (!res.ok) throw new Error(`model fetch failed: ${res.status}`);
  return res.arrayBuffer();
}
