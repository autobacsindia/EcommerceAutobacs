'use client';

/**
 * Edit a return staff already raised (owner, 2026-11-06): the problem text, the photos
 * and video, and the items — quantity down, an item off the return, the reason before
 * approval. There is deliberately NO price or amount field: the server reprices the
 * refund from the order, so an edit can only lower it. The server re-checks every rule
 * and refuses once the refund is with Accounts; `updatedAt` makes a stale form fail
 * instead of overwriting someone else's change.
 */
import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { staffKeys } from '@/hooks/queries/keys';
import { errorMessage, rupees } from '@/components/staff/sales/types';
import { RETURN_REASON_OPTIONS, RETURN_VIDEO_MAX_MB, isAllowedVideoLink } from '@/lib/constants';
import { getReturnUploadSignature, uploadReturnFile, type ReturnCredentials } from '@/lib/returnUploads';
import type { ReturnDetail } from './types';
import { input, primary, secondary } from './ui';

type Res = { success: boolean; return: ReturnDetail };
type Upload = { publicId: string; provider?: string; name: string };
type LineEdit = { quantity: number; reason: string; remove: boolean };

const UPLOAD_ENDPOINT = '/staff/returns/upload-targets';
const MB = 1024 * 1024;
const MAX_PHOTOS = 5;
const faultOf = (reason: string) => RETURN_REASON_OPTIONS.find((o) => o.value === reason)?.fault;

export default function EditReturnForm({ r, onDone }: { r: ReturnDetail; onDone: () => void }) {
  const qc = useQueryClient();
  const [description, setDescription] = useState(r.problemDescription);
  const [lines, setLines] = useState<Record<string, LineEdit>>(() =>
    Object.fromEntries(r.lines.map((l) => [l.key, { quantity: l.quantity, reason: l.reason, remove: false }])));
  const [keep, setKeep] = useState<number[]>(() => r.evidence.images.map((_, i) => i));
  const [added, setAdded] = useState<Upload[]>([]);
  const [video, setVideo] = useState<Upload | null>(null);
  const [videoLink, setVideoLink] = useState('');
  const [unused, setUnused] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState('');
  const sigRef = useRef<ReturnCredentials | null>(null);

  const photoCount = keep.length + added.length;
  const link = videoLink.trim();
  const linkOk = !link || isAllowedVideoLink(link);
  const staying = r.lines.filter((l) => !lines[l.key]?.remove);
  const newCustomerReason = r.lines.some((l) => {
    const e = lines[l.key];
    return e && !e.remove && e.reason !== l.reason && faultOf(e.reason) === 'customer';
  });

  const lineChanges = r.lines.flatMap((l) => {
    const e = lines[l.key];
    if (!e) return [];
    if (e.remove) return [{ key: l.key, remove: true }];
    const c: { key: string; quantity?: number; reason?: string } = { key: l.key };
    if (e.quantity !== l.quantity) c.quantity = e.quantity;
    if (e.reason !== l.reason) c.reason = e.reason;
    return c.quantity != null || c.reason != null ? [c] : [];
  });
  const photosChanged = added.length > 0 || keep.length !== r.evidence.images.length;
  const evidenceChanged = photosChanged || !!video || (!!link && link !== (r.evidence.videoLink || ''));
  const textChanged = description.trim() !== r.problemDescription;
  const anyChange = textChanged || lineChanges.length > 0 || evidenceChanged;

  const save = useMutation({
    mutationFn: () => apiClient.patch<Res>(`/staff/returns/${r.id}`, {
      updatedAt: r.updatedAt,
      ...(textChanged && { description: description.trim() }),
      ...(lineChanges.length > 0 && { lines: lineChanges }),
      ...(newCustomerReason && { unusedDeclared: unused }),
      ...(evidenceChanged && {
        evidence: {
          ...(photosChanged && { keepImages: keep, newImages: added.map(({ publicId, provider }) => ({ publicId, provider })) }),
          ...(video && { video: { publicId: video.publicId, provider: video.provider, resourceType: 'video' } }),
          ...(!video && link && { videoLink: link }),
        },
      }),
    }),
    onSuccess: (res) => {
      if (res?.return) qc.setQueryData(staffKeys.returnOne(r.id), res);
      qc.invalidateQueries({ queryKey: staffKeys.returns() });
      onDone();
    },
  });

  const upload = async (file: File, kind: 'photo' | 'video') => {
    const max = kind === 'video' ? RETURN_VIDEO_MAX_MB * MB : 10 * MB;
    if (file.size > max) {
      setUploadError(kind === 'video'
        ? `That video is over ${RETURN_VIDEO_MAX_MB}MB. Paste the customer's Google Drive or YouTube link instead.`
        : 'That photo is too large (max 10MB).');
      return;
    }
    setUploadError('');
    const slot = kind === 'video' ? 'video' : `photo${photoCount}`;
    setUploading(kind);
    try {
      let creds = sigRef.current;
      if (!creds || creds.provider === 'r2') {
        creds = await getReturnUploadSignature(slot, file.type || 'application/octet-stream', UPLOAD_ENDPOINT);
        if (creds.provider !== 'r2') sigRef.current = creds;
      }
      const ref = await uploadReturnFile(file, creds, kind === 'video' ? 'video' : 'image', undefined, slot);
      const up = { publicId: ref.publicId, provider: ref.provider, name: file.name };
      if (kind === 'video') { setVideo(up); setVideoLink(''); } else setAdded((a) => [...a, up]);
    } catch (e) {
      setUploadError((e as Error).message || 'Upload failed. Try again.');
    } finally {
      setUploading(null);
    }
  };

  const ready = anyChange && description.trim().length > 0 && staying.length > 0
    && (r.evidence.images.length === 0 || photoCount > 0) && linkOk && (!newCustomerReason || unused) && !uploading;

  return (
    <section aria-label="Edit return" className="space-y-3 rounded-lg border border-blue-200 bg-blue-50/40 p-3">
      <h4 className="text-sm font-semibold text-gray-900">Edit this return</h4>

      <ul className="space-y-2">
        {r.lines.map((l) => {
          const e = lines[l.key];
          return (
            <li key={l.key} className={`rounded border border-gray-200 bg-white p-2 ${e.remove ? 'opacity-60' : ''}`}>
              <p className="font-medium text-gray-900">{l.name} <span className="font-normal text-gray-500">· {rupees(l.unitPrice)} each (the order price)</span></p>
              {!e.remove && (
                <div className="mt-2 grid gap-2 sm:grid-cols-[7rem_1fr]">
                  <select className={input} aria-label={`How many ${l.name}`} value={e.quantity}
                    onChange={(ev) => setLines({ ...lines, [l.key]: { ...e, quantity: Number(ev.target.value) } })}>
                    {Array.from({ length: l.quantity }, (_, i) => l.quantity - i).map((q) => <option key={q} value={q}>{q}</option>)}
                  </select>
                  {r.can.editReason ? (
                    <select className={input} aria-label={`Reason for ${l.name}`} value={e.reason}
                      onChange={(ev) => setLines({ ...lines, [l.key]: { ...e, reason: ev.target.value } })}>
                      {RETURN_REASON_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : (
                    <p className="self-center text-xs text-gray-600">{l.reasonLabel}</p>
                  )}
                </div>
              )}
              {r.can.editRemoveLine && r.lines.length > 1 && (
                <label className="mt-2 flex items-center gap-1.5 text-xs text-gray-700">
                  <input type="checkbox" checked={e.remove} disabled={!e.remove && staying.length <= 1}
                    onChange={(ev) => setLines({ ...lines, [l.key]: { ...e, remove: ev.target.checked } })} />
                  Take this item off the return
                </label>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-[11px] text-gray-500">The quantity can only go down. The refund is worked out again from the order price when you save.</p>

      {newCustomerReason && (
        <label className="flex items-start gap-2 text-xs text-gray-700">
          <input type="checkbox" className="mt-0.5" checked={unused} onChange={(ev) => setUnused(ev.target.checked)} />
          The customer confirms it is unused, not installed, and in its original box.
        </label>
      )}

      <textarea className={input} rows={2} aria-label="Problem" value={description} onChange={(ev) => setDescription(ev.target.value)} />

      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-700">Photos and video</p>
        <ul className="flex flex-wrap gap-2 text-xs">
          {r.evidence.images.map((_, i) => keep.includes(i) && (
            <li key={`old-${i}`} className="flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1">
              Customer photo {i + 1}
              <button type="button" aria-label={`Remove customer photo ${i + 1}`} className="text-gray-500 hover:text-red-700"
                disabled={photoCount <= 1} onClick={() => setKeep(keep.filter((k) => k !== i))}><X className="h-3 w-3" /></button>
            </li>
          ))}
          {added.map((a, i) => (
            <li key={a.publicId} className="flex items-center gap-1 rounded border border-green-300 bg-white px-2 py-1">
              New: {a.name}
              <button type="button" aria-label={`Remove ${a.name}`} className="text-gray-500 hover:text-red-700"
                onClick={() => setAdded(added.filter((_, j) => j !== i))}><X className="h-3 w-3" /></button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <label className={`${secondary} cursor-pointer`}>
            {uploading === 'photo' ? 'Uploading…' : 'Add photo'}
            <input type="file" accept="image/*" className="sr-only" disabled={!!uploading || photoCount >= MAX_PHOTOS}
              onChange={(ev) => { const f = ev.target.files?.[0]; ev.target.value = ''; if (f) void upload(f, 'photo'); }} />
          </label>
          <label className={`${secondary} cursor-pointer`}>
            {uploading === 'video' ? 'Uploading…' : 'Replace video'}
            <input type="file" accept="video/*" className="sr-only" disabled={!!uploading}
              onChange={(ev) => { const f = ev.target.files?.[0]; ev.target.value = ''; if (f) void upload(f, 'video'); }} />
          </label>
        </div>
        {video ? <p className="text-xs text-gray-600">New video: {video.name}</p> : (
          <input type="url" inputMode="url" className={input} maxLength={500} value={videoLink} onChange={(ev) => setVideoLink(ev.target.value)}
            placeholder="Or paste a new Google Drive / YouTube link for the video" aria-label="New unboxing video link" />
        )}
        {!linkOk && <p className="text-xs text-red-700">Only Google Drive or YouTube links starting with https://.</p>}
        {uploadError && <p role="alert" className="text-xs text-red-700">{uploadError}</p>}
      </div>

      {save.isError && <p role="alert" className="text-xs text-red-700">{errorMessage(save.error, 'Could not save. Refresh and try again.')}</p>}
      <div className="flex gap-2">
        <button type="button" className={primary} disabled={!ready || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save changes'}
        </button>
        <button type="button" className={secondary} onClick={onDone}>Cancel</button>
      </div>
    </section>
  );
}
