import { photoUrl, type Enquiry } from './enquiry';

/**
 * The uploaded photos of an enquiry as Files — for the phone's share sheet (which
 * can send text + photos to WhatsApp together) or a download on a computer.
 * wa.me links carry text only, so this is how photos reach a supplier.
 */

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/gif': 'gif' };

export const photoTotal = (e: Pick<Enquiry, 'items'>) => e.items.reduce((n, i) => n + (i.photos?.length ?? 0), 0);

/** Fetches every uploaded photo (private, through our API). Throws if any cannot be read. */
export async function photoFiles(e: Pick<Enquiry, 'id' | 'ref' | 'items'>): Promise<File[]> {
  const jobs = e.items.flatMap((item, i) => (item.photos ?? []).map((p, k) => async () => {
    const res = await fetch(photoUrl(e.id, p.id), { credentials: 'include' });
    if (!res.ok) throw new Error('Could not load the photos. Please try again.');
    const blob = await res.blob();
    const type = blob.type || p.contentType || 'image/jpeg';
    return new File([blob], `${e.ref}-item${i + 1}-${k + 1}.${EXT[type] ?? 'jpg'}`, { type });
  }));
  return Promise.all(jobs.map((job) => job()));
}

type ShareNav = Navigator & { canShare?: (d: ShareData) => boolean };

/** True when this browser can share files (most phones). Call after mount only. */
export function canShareFiles(): boolean {
  if (typeof navigator === 'undefined' || typeof File === 'undefined') return false;
  const nav = navigator as ShareNav;
  try {
    return typeof nav.share === 'function' && !!nav.canShare?.({ files: [new File([''], 'x.jpg', { type: 'image/jpeg' })] });
  } catch {
    return false;
  }
}

/** Saves each file through the browser's download (WhatsApp Web / desktop: attach them from there). */
export function downloadFiles(files: File[]) {
  files.forEach((f, i) => {
    // A short gap between downloads: some browsers drop rapid back-to-back ones.
    setTimeout(() => {
      const url = URL.createObjectURL(f);
      const a = document.createElement('a');
      a.href = url;
      a.download = f.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }, i * 300);
  });
}
