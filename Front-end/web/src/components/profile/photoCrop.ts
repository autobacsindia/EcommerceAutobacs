/**
 * Square-crop maths for the profile photo editor, kept pure so it is testable
 * without a canvas. The editor shows the picture "cover"-fitted in a square
 * viewport; the person zooms and drags; this turns that view into the source
 * rectangle to draw onto a square canvas.
 */

/** What the browser accepts before cropping; the server re-checks the real bytes. */
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
/** The picked file may be large — it is shrunk to OUTPUT_SIZE before upload (server limit is 3 MB). */
export const MAX_PICK_BYTES = 15 * 1024 * 1024;
export const OUTPUT_SIZE = 512;
export const MAX_ZOOM = 3;

export type CropView = { zoom: number; x: number; y: number };

/** Why a picked file cannot be used, or null if it can. */
export function photoProblem(file: { type: string; size: number }): string | null {
  if (!(PHOTO_TYPES as readonly string[]).includes(file.type)) return 'Please choose a JPG, PNG or WebP picture.';
  if (file.size > MAX_PICK_BYTES) return 'That picture is too big. Please choose one under 15 MB.';
  return null;
}

/** Scale (screen px per source px) at a given zoom; zoom 1 = the short side fills the square. */
export const scaleFor = (w: number, h: number, viewport: number, zoom: number) => (viewport / Math.min(w, h)) * zoom;

/** Keep the picture covering the whole square: offsets are the image's top-left inside the viewport (≤ 0). */
export function clampView(w: number, h: number, viewport: number, view: CropView): CropView {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, view.zoom));
  const s = scaleFor(w, h, viewport, zoom);
  const clamp = (v: number, size: number) => Math.min(0, Math.max(viewport - size * s, v));
  return { zoom, x: clamp(view.x, w), y: clamp(view.y, h) };
}

/** The view that starts centred at zoom 1. */
export function centredView(w: number, h: number, viewport: number): CropView {
  const s = scaleFor(w, h, viewport, 1);
  return { zoom: 1, x: (viewport - w * s) / 2, y: (viewport - h * s) / 2 };
}

/** Re-zoom around the square's centre, so the face in the middle stays in the middle. */
export function zoomTo(w: number, h: number, viewport: number, view: CropView, zoom: number): CropView {
  const before = scaleFor(w, h, viewport, view.zoom);
  const after = scaleFor(w, h, viewport, Math.min(MAX_ZOOM, Math.max(1, zoom)));
  const c = viewport / 2;
  const sx = (c - view.x) / before;
  const sy = (c - view.y) / before;
  return clampView(w, h, viewport, { zoom, x: c - sx * after, y: c - sy * after });
}

/** The source rectangle (in image pixels) the square viewport is showing. */
export function sourceRect(w: number, h: number, viewport: number, view: CropView) {
  const v = clampView(w, h, viewport, view);
  const s = scaleFor(w, h, viewport, v.zoom);
  const side = viewport / s;
  return { sx: (0 - v.x) / s, sy: (0 - v.y) / s, side };
}

/** Draw the chosen square onto a canvas and encode it (JPEG keeps a photo small). */
export async function renderSquare(img: CanvasImageSource & { naturalWidth: number; naturalHeight: number }, viewport: number, view: CropView): Promise<Blob> {
  const { sx, sy, side } = sourceRect(img.naturalWidth, img.naturalHeight, viewport, view);
  const canvas = document.createElement('canvas');
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot crop pictures.');
  ctx.fillStyle = '#fff'; // a transparent PNG becomes white, not black, as JPEG
  ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
  ctx.drawImage(img, sx, sy, side, side, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not prepare the picture.'))), 'image/jpeg', 0.9),
  );
}
