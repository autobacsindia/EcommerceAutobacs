'use client';

/**
 * Profile photo: show it (or initials), pick a new one, crop it to a square with
 * zoom and drag, preview, then upload. The server stores it and deletes the old
 * one only after the new one is saved (routes/profile.js). Used by the customer
 * /profile page and the staff/admin "My profile" page.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Camera, Trash2 } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { submitMultipart, parseApiResponse } from '@/lib/multipartResponse';
import PersonFace from './PersonFace';
import { PHOTO_TYPES, MAX_ZOOM, centredView, clampView, photoProblem, renderSquare, scaleFor, zoomTo, type CropView } from './photoCrop';

const VIEWPORT = 240;

type Props = {
  name: string;
  photoUrl: string;
  /** Called after the server has stored (or removed) the photo. */
  onChanged: (url: string) => void | Promise<void>;
  /** Fallback face colours — each screen keeps its own look. */
  faceClassName?: string;
  buttonClassName?: string;
};

export default function PhotoEditor({ name, photoUrl, onChanged, faceClassName = 'bg-gray-200 text-gray-700', buttonClassName = '' }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number; view: CropView } | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [view, setView] = useState<CropView>({ zoom: 1, x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Free the object URL when the picture changes or the editor closes.
  useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, [src]);

  function pick(file: File | undefined) {
    setError('');
    if (!file) return;
    const problem = photoProblem(file);
    if (problem) { setError(problem); return; }
    setSize(null);
    setSrc(URL.createObjectURL(file));
  }

  function onLoaded() {
    const img = imgRef.current;
    if (!img) return;
    const s = { w: img.naturalWidth, h: img.naturalHeight };
    setSize(s);
    setView(centredView(s.w, s.h, VIEWPORT));
  }

  function close() {
    setSrc(null);
    setSize(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  const onPointerDown = (e: ReactPointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, view };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || !size) return;
    setView(clampView(size.w, size.h, VIEWPORT, { ...d.view, x: d.view.x + e.clientX - d.x, y: d.view.y + e.clientY - d.y }));
  };
  const onPointerUp = () => { drag.current = null; };

  async function save() {
    const img = imgRef.current;
    if (!img || !size) return;
    setBusy(true);
    setError('');
    try {
      const blob = await renderSquare(img, VIEWPORT, view);
      const fd = new FormData();
      fd.append('avatar', blob, 'profile.jpg');
      const res = await submitMultipart('/api/v1/profile/avatar', 'POST', fd);
      const data = (await parseApiResponse(res)) as { message?: string; avatar?: { url?: string } };
      if (!res.ok || !data.avatar?.url) throw new Error(data.message || 'Could not save the photo. Please try again.');
      close();
      await onChanged(data.avatar.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the photo. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError('');
    try {
      await apiClient.delete('/profile/avatar');
      await onChanged('');
    } catch {
      setError('Could not remove the photo. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const scale = size ? scaleFor(size.w, size.h, VIEWPORT, view.zoom) : 1;

  return (
    <div>
      <div className="flex items-center gap-4">
        <PersonFace name={name} photoUrl={photoUrl} className={`h-20 w-20 text-2xl font-bold ${faceClassName}`} />
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${buttonClassName}`}>
            <Camera className="h-4 w-4" aria-hidden="true" /> {photoUrl ? 'Change photo' : 'Add photo'}
          </button>
          {photoUrl && (
            <button type="button" onClick={remove} disabled={busy}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${buttonClassName}`}>
              <Trash2 className="h-4 w-4" aria-hidden="true" /> Remove
            </button>
          )}
        </div>
        <input ref={fileRef} type="file" accept={PHOTO_TYPES.join(',')} className="sr-only" aria-label="Choose a profile photo"
          onChange={(e) => pick(e.target.files?.[0])} />
      </div>

      {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}

      {src && (
        <div role="dialog" aria-modal="true" aria-label="Crop your photo" className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
          <div className="w-full max-w-xs rounded-2xl bg-white p-4 text-gray-900 shadow-xl">
            <p className="text-sm font-semibold">Drag to position, zoom to fit</p>
            <div
              className="relative mx-auto mt-3 cursor-move touch-none overflow-hidden rounded-full bg-gray-100"
              style={{ width: VIEWPORT, height: VIEWPORT }}
              onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imgRef} src={src} alt="Your new photo" onLoad={onLoaded} draggable={false}
                className="absolute left-0 top-0 max-w-none select-none"
                style={size ? { width: size.w * scale, height: size.h * scale, transform: `translate(${view.x}px, ${view.y}px)` } : { opacity: 0 }}
              />
            </div>
            <label className="mt-3 block text-xs font-medium text-gray-600">
              Zoom
              <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={view.zoom} disabled={!size}
                onChange={(e) => size && setView(zoomTo(size.w, size.h, VIEWPORT, view, Number(e.target.value)))}
                className="mt-1 w-full" />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={close} disabled={busy} className="rounded-full px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100">Cancel</button>
              <button type="button" onClick={save} disabled={busy || !size} className="rounded-full bg-emerald-700 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
                {busy ? 'Saving…' : 'Save photo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
