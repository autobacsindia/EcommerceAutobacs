'use client';

/**
 * "Raise return" from a team order — a GTM seller or operations raising it for the
 * customer (phone, WhatsApp, walk-in). The same rules as the website apply, and the
 * server re-checks all of them:
 *   - at least one photo the customer sent; a video for transit damage or any item
 *     worth more than ₹10,000;
 *   - 7 days from delivery for a fault on our side, 4 for the customer's own reason;
 *   - a customer-reason return needs the item unused, uninstalled, in its box.
 * Photos and the video go straight to private storage; only references are sent.
 */
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Undo2, X } from 'lucide-react';
import Link from 'next/link';
import apiClient from '@/lib/api-client';
import { staffKeys } from '@/hooks/queries/keys';
import { errorMessage, rupees } from '@/components/staff/sales/types';
import { RETURN_REASON_OPTIONS } from '@/lib/constants';
import { getReturnUploadSignature, uploadReturnFile, type ReturnCredentials, type ReturnResourceType } from '@/lib/returnUploads';
import { input, primary, secondary } from './ui';

type Options = {
  orderId: string;
  orderNumber: string;
  customer: string;
  paid: boolean;
  repeatReturns: number;
  lines: {
    itemId: string; name: string; unitPrice: number; quantity: number; returnableQuantity: number;
    deliveredAt: string | null; windowEnds: { ours: string; customer: string } | null; returnableForCustomerReason: boolean;
  }[];
};
type Upload = { publicId: string; provider?: string; name: string };

const UPLOAD_ENDPOINT = '/staff/returns/upload-targets';
const VIDEO_ABOVE = 10000;
const MB = 1024 * 1024;

function reasonOpen(line: Options['lines'][number], fault: 'ours' | 'customer', now: number) {
  if (!line.windowEnds) return false;
  return new Date(line.windowEnds[fault]).getTime() >= now;
}

function Dialog({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [now] = useState(() => Date.now());
  const opts = useQuery({
    queryKey: staffKeys.returnOptions(orderId),
    queryFn: () => apiClient.get<{ success: boolean; options: Options }>(`/staff/returns/orders/${orderId}/options`),
  });
  const [picked, setPicked] = useState<Record<string, { quantity: number; reason: string }>>({});
  const [description, setDescription] = useState('');
  const [unused, setUnused] = useState(false);
  const [photos, setPhotos] = useState<Upload[]>([]);
  const [video, setVideo] = useState<Upload | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState('');
  const sigRef = useRef<ReturnCredentials | null>(null);

  const o = opts.data?.options;
  const chosen = Object.entries(picked);
  const needsVideo = chosen.some(([id, p]) => {
    const line = o?.lines.find((l) => l.itemId === id);
    return p.reason === 'transit_damage' || (line ? line.unitPrice * p.quantity > VIDEO_ABOVE : false);
  });
  const anyCustomer = chosen.some(([, p]) => RETURN_REASON_OPTIONS.find((r) => r.value === p.reason)?.fault === 'customer');

  const submit = useMutation({
    mutationFn: () => apiClient.post<{ success: boolean; return: { id: string; ref: string } }>('/staff/returns', {
      orderId,
      items: chosen.map(([itemId, p]) => ({ itemId, quantity: p.quantity, reason: p.reason })),
      description,
      unusedDeclared: anyCustomer ? unused : undefined,
      images: photos.map(({ publicId, provider }) => ({ publicId, provider })),
      ...(video && { video: { publicId: video.publicId, provider: video.provider, resourceType: 'video' } }),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: staffKeys.returns() }),
  });

  const upload = async (file: File, kind: 'photo' | 'video') => {
    const max = kind === 'video' ? 60 * MB : 10 * MB;
    if (file.size > max) { setUploadError(`That ${kind} is too large (max ${max / MB}MB).`); return; }
    setUploadError('');
    const slot = kind === 'video' ? 'video' : `photo${photos.length}`;
    const resourceType: ReturnResourceType = kind === 'video' ? 'video' : 'image';
    setUploading(kind);
    try {
      let creds = sigRef.current;
      if (!creds || creds.provider === 'r2') {
        creds = await getReturnUploadSignature(slot, file.type || 'application/octet-stream', UPLOAD_ENDPOINT);
        if (creds.provider !== 'r2') sigRef.current = creds;
      }
      const ref = await uploadReturnFile(file, creds, resourceType, undefined, slot);
      const up = { publicId: ref.publicId, provider: ref.provider, name: file.name };
      if (kind === 'video') setVideo(up); else setPhotos((p) => [...p, up].slice(0, 5));
    } catch (e) {
      setUploadError((e as Error).message || 'Upload failed. Try again.');
    } finally {
      setUploading(null);
    }
  };

  const ready = chosen.length > 0 && chosen.every(([, p]) => p.reason) && description.trim() && photos.length > 0
    && (!needsVideo || video) && (!anyCustomer || unused) && !uploading;

  if (submit.isSuccess) {
    return (
      <div className="space-y-3 text-sm">
        <p className="font-semibold text-green-800">Return {submit.data.return.ref} raised. Operations will check the photos.</p>
        <p className="text-gray-600">The customer gets an email. You&apos;ll see each step under Returns → Mine.</p>
        <div className="flex gap-2">
          <Link href="/team/returns?tab=mine" className={primary}>Open Returns</Link>
          <button type="button" className={secondary} onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }
  if (opts.isPending) return <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading the order…</p>;
  if (opts.isError || !o) return <p role="alert" className="text-sm text-red-700">{errorMessage(opts.error, 'Could not load this order.')}</p>;
  const returnable = o.lines.filter((l) => l.returnableQuantity > 0);

  return (
    <div className="space-y-4 text-sm">
      <p className="text-gray-600">Order {o.orderNumber} · {o.customer}</p>
      {o.repeatReturns > 0 && <p className="text-xs font-semibold text-amber-800">This customer raised {o.repeatReturns} return{o.repeatReturns > 1 ? 's' : ''} in the last 6 months.</p>}
      {!returnable.length && <p className="text-gray-600">Nothing on this order can be returned (not delivered yet, or already returned).</p>}
      <ul className="space-y-2">
        {returnable.map((l) => {
          const p = picked[l.itemId];
          return (
            <li key={l.itemId} className="rounded border border-gray-200 p-2">
              <label className="flex items-center gap-2 font-medium text-gray-900">
                <input type="checkbox" checked={!!p} onChange={(e) => setPicked((cur) => {
                  const next = { ...cur };
                  if (e.target.checked) next[l.itemId] = { quantity: 1, reason: '' }; else delete next[l.itemId];
                  return next;
                })} />
                {l.name} <span className="font-normal text-gray-500">· {rupees(l.unitPrice)} · {l.returnableQuantity} can come back</span>
              </label>
              {p && (
                <div className="mt-2 grid gap-2 sm:grid-cols-[6rem_1fr]">
                  <input className={input} type="number" min={1} max={l.returnableQuantity} value={p.quantity} aria-label={`How many ${l.name}`}
                    onChange={(e) => setPicked({ ...picked, [l.itemId]: { ...p, quantity: Math.max(1, Math.min(l.returnableQuantity, Number(e.target.value) || 1)) } })} />
                  <select className={input} value={p.reason} aria-label={`Reason for ${l.name}`}
                    onChange={(e) => setPicked({ ...picked, [l.itemId]: { ...p, reason: e.target.value } })}>
                    <option value="">Why is it coming back?</option>
                    {RETURN_REASON_OPTIONS.map((r) => {
                      const closed = !reasonOpen(l, r.fault, now);
                      const blocked = r.fault === 'customer' && !l.returnableForCustomerReason;
                      return (
                        <option key={r.value} value={r.value} disabled={closed || blocked}>
                          {r.label}{closed ? ' (window closed)' : blocked ? ' (not returnable)' : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <textarea className={input} rows={2} placeholder="What's wrong, in the customer's words" value={description} onChange={(e) => setDescription(e.target.value)} />
      {anyCustomer && (
        <label className="flex items-start gap-2 text-xs text-gray-700">
          <input type="checkbox" className="mt-0.5" checked={unused} onChange={(e) => setUnused(e.target.checked)} />
          The customer confirms it is unused, not installed, and in its original box. (They get the item price back, minus the real pickup cost.)
        </label>
      )}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-700">The customer&apos;s photos (at least one){needsVideo ? ' and a video (needed for transit damage or items over ₹10,000)' : ''}</p>
        <div className="flex flex-wrap gap-2">
          <label className={`${secondary} cursor-pointer`}>
            {uploading === 'photo' ? 'Uploading…' : 'Add photo'}
            <input type="file" accept="image/*" className="sr-only" disabled={!!uploading || photos.length >= 5}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f, 'photo'); }} />
          </label>
          <label className={`${secondary} cursor-pointer`}>
            {uploading === 'video' ? 'Uploading…' : video ? 'Replace video' : 'Add video'}
            <input type="file" accept="video/*" className="sr-only" disabled={!!uploading}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f, 'video'); }} />
          </label>
        </div>
        {(photos.length > 0 || video) && (
          <p className="text-xs text-gray-600">{[...photos.map((p) => p.name), video ? `🎥 ${video.name}` : null].filter(Boolean).join(' · ')}</p>
        )}
        {uploadError && <p role="alert" className="text-xs text-red-700">{uploadError}</p>}
      </div>
      {submit.isError && <p role="alert" className="text-xs text-red-700">{errorMessage(submit.error, 'Could not raise the return.')}</p>}
      <div className="flex gap-2">
        <button type="button" className={primary} disabled={!ready || submit.isPending} onClick={() => submit.mutate()}>
          {submit.isPending ? 'Raising…' : 'Raise return'}
        </button>
        <button type="button" className={secondary} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

/** The button on a team order; the dialog opens over the page. */
export default function RaiseReturnButton({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={secondary} onClick={() => setOpen(true)}>
        <Undo2 className="h-3.5 w-3.5" /> Raise return
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Raise a return">
          <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">Raise a return</h3>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-gray-500 hover:text-gray-800"><X className="h-5 w-5" /></button>
            </div>
            <Dialog orderId={orderId} onClose={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
