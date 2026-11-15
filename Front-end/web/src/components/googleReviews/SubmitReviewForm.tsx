'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ImagePlus, Loader2, X } from 'lucide-react';
import PasteZone from '@/components/ui/PasteZone';
import StarPicker from './StarPicker';
import { useSubmitGoogleReview } from '@/hooks/queries/useGoogleReviews';
import { errorText, newSubmitId, SCREENSHOT_ACCEPT, screenshotProblem, type ReviewPolicy } from '@/lib/googleReviews';

const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';

/**
 * A salesperson sends a Google review screenshot. The server checks everything
 * again (type, size, duplicates, the order); the checks here are only to give a
 * quick, friendly answer before the upload.
 */
export default function SubmitReviewForm({ policy }: { policy: ReviewPolicy }) {
  const submit = useSubmitGoogleReview();
  const [submitId, setSubmitId] = useState(() => newSubmitId());
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [orderRef, setOrderRef] = useState('');
  const [claimedStars, setClaimedStars] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!file) { setPreview(''); return undefined; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const pick = (f: File | undefined | null) => {
    setDone('');
    if (!f) return;
    const problem = screenshotProblem(f, policy.maxScreenshotBytes);
    setError(problem);
    setFile(problem ? null : f);
  };

  const reset = () => {
    setFile(null); setCustomerName(''); setCustomerPhone(''); setOrderRef(''); setClaimedStars(null); setNotes('');
    setSubmitId(newSubmitId());
    if (fileRef.current) fileRef.current.value = '';
  };

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setDone('');
    const problem = screenshotProblem(file, policy.maxScreenshotBytes);
    if (problem) { setError(problem); return; }
    const phoneDigits = customerPhone.replace(/\D/g, '');
    if (!customerName.trim() && !phoneDigits) { setError('Enter the customer\'s name or phone number.'); return; }
    if (phoneDigits && phoneDigits.slice(-10).length < 10) { setError('Enter the customer\'s 10-digit mobile number, or leave it empty.'); return; }
    const form = new FormData();
    form.append('submitId', submitId);
    form.append('customerName', customerName.trim());
    form.append('customerPhone', customerPhone.trim());
    form.append('orderRef', orderRef.trim());
    if (claimedStars) form.append('claimedStars', String(claimedStars));
    form.append('notes', notes.trim());
    form.append('screenshot', file as File);
    try {
      await submit.mutateAsync(form);
      reset();
      setDone('Sent. The marketing head will check it — you will see the result in the list below.');
    } catch (err) {
      setError(errorText(err, 'Could not send the review. Please try again.'));
    }
  }

  const busy = submit.isPending;
  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-gray-200 bg-white p-4" aria-labelledby="send-review">
      <div>
        <h2 id="send-review" className="text-lg font-semibold text-gray-900">Send a Google review</h2>
        <p className="text-sm text-gray-500">After the customer posts a review, take a screenshot of it and send it here. Verified reviews add points to your Roav Points.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <span className="text-sm font-medium text-gray-700">Screenshot of the review *</span>
          <PasteZone accept={SCREENSHOT_ACCEPT} single onFiles={(fs) => pick(fs[0])} disabled={busy} className="mt-1">
            {preview ? (
              <div className="relative inline-block">
                {/* eslint-disable-next-line @next/next/no-img-element -- a local blob preview, not a site image */}
                <img src={preview} alt="Screenshot to send" className="max-h-64 rounded-lg border border-gray-200 object-contain" />
                <button type="button" aria-label="Remove screenshot" onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ''; }}
                  className="absolute right-1 top-1 rounded-full bg-white/90 p-1 shadow hover:bg-white"><X className="h-4 w-4" /></button>
              </div>
            ) : (
              <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
                className="flex w-full flex-col items-center gap-1 rounded-lg border-2 border-dashed border-gray-300 px-4 py-8 text-sm text-gray-600 hover:border-blue-400 hover:bg-blue-50">
                <ImagePlus className="h-6 w-6 text-gray-400" />
                Choose a screenshot
                <span className="text-xs text-gray-400">JPG, PNG or WebP, up to {Math.round(policy.maxScreenshotBytes / (1024 * 1024))} MB</span>
              </button>
            )}
          </PasteZone>
          <input ref={fileRef} type="file" accept={SCREENSHOT_ACCEPT} className="sr-only" aria-label="Screenshot file"
            onChange={(e) => pick(e.target.files?.[0])} />
        </div>

        <div className="space-y-3">
          <label className="block text-sm"><span className="text-gray-700">Customer name</span>
            <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} maxLength={100} className={input} placeholder="As on the review" />
          </label>
          <label className="block text-sm"><span className="text-gray-700">Customer phone</span>
            <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} inputMode="tel" maxLength={20} className={input} placeholder="98470 12345" />
            <span className="text-xs text-gray-400">Name or phone is needed. The phone stops the same review being sent twice.</span>
          </label>
          <label className="block text-sm"><span className="text-gray-700">Order number (optional)</span>
            <input value={orderRef} onChange={(e) => setOrderRef(e.target.value)} maxLength={30} className={input} placeholder="#12345" />
          </label>
          <div className="text-sm"><span className="text-gray-700">Stars you saw (optional)</span>
            <StarPicker value={claimedStars} onChange={setClaimedStars} label="Stars you saw" clearable disabled={busy} />
          </div>
        </div>
      </div>

      <label className="block text-sm"><span className="text-gray-700">Notes (optional)</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} rows={2} className={input} placeholder="Anything the marketing head should know" />
      </label>

      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {done && <p role="status" className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800"><CheckCircle2 className="h-4 w-4" />{done}</p>}

      <button type="submit" disabled={busy}
        className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}{busy ? 'Sending…' : 'Send for checking'}
      </button>
    </form>
  );
}
