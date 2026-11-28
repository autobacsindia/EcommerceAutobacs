'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { adminKeys, reelKeys } from '@/hooks/queries/keys';
import { formatCurrency } from '@/lib/utils';
import { CAPTION_MAX, createTeamReel, errorText } from './api';
import {
  VIDEO_INPUT_ACCEPT, WRONG_TYPE_MESSAGE, checkVideoFile, getReelUploadTarget, readVideoDuration, uploadVideoToStorage,
  videoTypeOf,
} from './videoUpload';

interface ProductHit { _id: string; name: string; price: number; images?: (string | { url?: string })[] }
interface UserHit { _id: string; name?: string; email?: string; phone?: string }

const firstImage = (p: ProductHit): string | null => {
  const i = p.images?.[0];
  if (!i) return null;
  return typeof i === 'string' ? i : i.url || null;
};

type Stage = 'idle' | 'signing' | 'uploading' | 'saving';

/**
 * "Upload team reel": the video goes browser → Cloudflare R2 (presigned PUT), then
 * only its storage key + product id + caption go to our API. Team reels skip review.
 */
export default function TeamReelUpload({ onDone }: { onDone?: () => void }) {
  const ids = useId();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // Kept after a successful upload so a failed save can be retried WITHOUT uploading the video again.
  const [uploaded, setUploaded] = useState<{ file: File; publicId: string } | null>(null);
  const [product, setProduct] = useState<ProductHit | null>(null);
  const [creator, setCreator] = useState<UserHit | null>(null);
  const [caption, setCaption] = useState('');
  const [stage, setStage] = useState<Stage>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [converting, setConverting] = useState(false);

  const [productTerm, setProductTerm] = useState('');
  const [productQuery, setProductQuery] = useState('');
  const [userTerm, setUserTerm] = useState('');
  const [userQuery, setUserQuery] = useState('');

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const products = useQuery({
    queryKey: adminKeys.list('reel-product-search', { search: productQuery }),
    enabled: productQuery.length >= 2,
    queryFn: async () => {
      const res = (await apiClient.get(`/products?search=${encodeURIComponent(productQuery)}&limit=8`)) as unknown as { products?: ProductHit[] };
      return res?.products ?? [];
    },
  });
  const users = useQuery({
    queryKey: adminKeys.list('reel-creator-search', { search: userQuery }),
    enabled: userQuery.length >= 2,
    queryFn: async () => {
      const res = (await apiClient.get(`/users?search=${encodeURIComponent(userQuery)}&limit=8`)) as unknown as { users?: UserHit[] };
      return res?.users ?? [];
    },
  });

  const busy = stage !== 'idle';

  function pickFile(f: File | null) {
    setError(null);
    setDone(false);
    if (!f) return;
    if (!videoTypeOf(f)) {
      setError(WRONG_TYPE_MESSAGE);
      if (fileRef.current) fileRef.current.value = ''; // so picking the same file again re-checks it
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(f);
    setPreviewUrl(typeof URL.createObjectURL === 'function' ? URL.createObjectURL(f) : null);
  }

  async function submit() {
    if (busy) return; // double-click guard
    setError(null);
    if (!file) return setError('Pick a video first.');
    if (!product) return setError('Tag the product shown in the video.');
    try {
      let publicId = uploaded?.file === file ? uploaded.publicId : null;
      if (!publicId) {
        setStage('signing');
        const target = await getReelUploadTarget(file);
        const problem = checkVideoFile(file, target);
        if (problem) throw new Error(problem);
        const duration = await readVideoDuration(file);
        if (duration !== null && target.maxDurationSec && duration > target.maxDurationSec + 0.5) {
          throw new Error(`This video is ${Math.round(duration)} seconds long. Reels can be up to ${target.maxDurationSec} seconds.`);
        }
        setStage('uploading');
        setProgress(0);
        ({ publicId } = await uploadVideoToStorage(file, target, setProgress));
        setUploaded({ file, publicId });
      }
      setStage('saving');
      const saved = (await createTeamReel({
        publicId,
        productId: product._id,
        caption: caption.trim(),
        ...(creator ? { creatorUserId: creator._id } : {}),
      })) as unknown as { reel?: { status?: string }; status?: string } | null;
      // HEVC and similar clips are converted on the server first, then go live by themselves.
      setConverting((saved?.reel?.status ?? saved?.status) === 'processing');
      await qc.invalidateQueries({ queryKey: reelKeys.admin() });
      // Reset for the next reel.
      setFile(null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      setUploaded(null);
      setCaption('');
      setProduct(null);
      setCreator(null);
      if (fileRef.current) fileRef.current.value = '';
      setDone(true);
      onDone?.();
    } catch (err) {
      // A 400/403 on save means the server refused the stored video and deleted it
      // (wrong format, too long, HEVC…). Forget it, so the next try uploads again
      // instead of re-sending a key that no longer exists.
      const status = (err as { status?: unknown } | null)?.status;
      if (status === 400 || status === 403) setUploaded(null);
      setError(errorText(err, 'Could not upload the reel. Please try again.'));
    } finally {
      setStage('idle');
    }
  }

  const stageText = stage === 'signing' ? 'Getting ready…'
    : stage === 'uploading' ? `Uploading video… ${progress}%`
      : stage === 'saving' ? 'Publishing…' : null;

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm" aria-labelledby={`${ids}-h`}>
      <h2 id={`${ids}-h`} className="text-base font-semibold text-gray-900">Upload team reel</h2>
      <p className="mt-0.5 text-sm text-gray-500">Team reels go live straight away — no review needed.</p>

      <div className="mt-4 grid gap-4 md:grid-cols-[180px_1fr]">
        <div>
          <label htmlFor={`${ids}-file`} className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Video</label>
          <div className="aspect-[9/16] w-full max-w-[180px] overflow-hidden rounded-lg bg-gray-100">
            {previewUrl ? (
              <video src={previewUrl} className="h-full w-full object-cover" muted playsInline controls />
            ) : (
              <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
                className="flex h-full w-full items-center justify-center p-3 text-center text-sm text-gray-500 hover:bg-gray-200">
                Tap to pick a vertical video (up to 60s)
              </button>
            )}
          </div>
          <input ref={fileRef} id={`${ids}-file`} type="file" accept={VIDEO_INPUT_ACCEPT} disabled={busy}
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)} className="mt-2 block w-full max-w-[180px] text-xs" />
          <p className="mt-1 max-w-[180px] text-xs text-gray-500">
            MP4, MOV or 3GP, up to 60 seconds. iPhone: set Camera → Formats → Most Compatible.
          </p>
        </div>

        <div className="space-y-4">
          {/* Product */}
          <div>
            <label htmlFor={`${ids}-product`} className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Product in the video</label>
            {product ? (
              <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-2">
                {firstImage(product) ? (
                  // eslint-disable-next-line @next/next/no-img-element -- admin thumbnail
                  <img src={firstImage(product)!} alt="" className="h-10 w-10 rounded object-cover" />
                ) : <div className="h-10 w-10 rounded bg-gray-200" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">{product.name}</p>
                  <p className="text-xs text-gray-600">{formatCurrency(product.price)}</p>
                </div>
                <button type="button" onClick={() => setProduct(null)} disabled={busy} className="text-xs font-semibold text-gray-600 underline">Change</button>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <input id={`${ids}-product`} value={productTerm} onChange={(e) => setProductTerm(e.target.value)} placeholder="Search by product name"
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setProductQuery(productTerm.trim()); } }}
                    className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                  <button type="button" onClick={() => setProductQuery(productTerm.trim())}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">Search</button>
                </div>
                {products.isFetching && <p className="mt-1 text-xs text-gray-500">Searching…</p>}
                {products.isError && <p className="mt-1 text-xs text-red-700">Product search failed.</p>}
                {products.isSuccess && products.data.length === 0 && <p className="mt-1 text-xs text-gray-500">No products found.</p>}
                {products.data && products.data.length > 0 && (
                  <ul className="mt-2 max-h-56 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200">
                    {products.data.map((p) => (
                      <li key={p._id}>
                        <button type="button" onClick={() => setProduct(p)} className="flex w-full items-center gap-3 p-2 text-left hover:bg-gray-50">
                          {firstImage(p) ? (
                            // eslint-disable-next-line @next/next/no-img-element -- admin thumbnail
                            <img src={firstImage(p)!} alt="" className="h-8 w-8 rounded object-cover" loading="lazy" />
                          ) : <div className="h-8 w-8 rounded bg-gray-200" />}
                          <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                          <span className="text-xs text-gray-600">{formatCurrency(p.price)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          {/* Caption */}
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Caption</span>
            <textarea value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={CAPTION_MAX} rows={2} disabled={busy}
              className="w-full rounded-lg border border-gray-300 p-2 text-sm" placeholder="e.g. 70mai dash cam — clear night video" />
            <span className="text-[11px] text-gray-400">{caption.length}/{CAPTION_MAX}</span>
          </label>

          {/* Optional creator */}
          <div>
            <label htmlFor={`${ids}-creator`} className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Creator (optional)</label>
            {creator ? (
              <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-2 text-sm">
                <span className="truncate">{creator.name || creator.email || creator.phone}</span>
                <button type="button" onClick={() => setCreator(null)} disabled={busy} className="text-xs font-semibold text-gray-600 underline">Clear</button>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <input id={`${ids}-creator`} value={userTerm} onChange={(e) => setUserTerm(e.target.value)} placeholder="Name, email or phone — leave empty for Autobacs"
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setUserQuery(userTerm.trim()); } }}
                    className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                  <button type="button" onClick={() => setUserQuery(userTerm.trim())}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">Find</button>
                </div>
                {users.isError && <p className="mt-1 text-xs text-red-700">User search failed.</p>}
                {users.isSuccess && users.data.length === 0 && <p className="mt-1 text-xs text-gray-500">No one found.</p>}
                {users.data && users.data.length > 0 && (
                  <ul className="mt-2 max-h-44 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200">
                    {users.data.map((u) => (
                      <li key={u._id}>
                        <button type="button" onClick={() => setCreator(u)} className="w-full p-2 text-left text-sm hover:bg-gray-50">
                          {u.name || '—'} <span className="text-xs text-gray-500">{u.email || u.phone}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          {stageText && (
            <div aria-live="polite">
              <p className="text-sm text-gray-700">{stageText}</p>
              {stage === 'uploading' && (
                <div className="mt-1 h-2 w-full overflow-hidden rounded bg-gray-200">
                  <div className="h-full bg-gray-900 transition-[width]" style={{ width: `${progress}%` }} />
                </div>
              )}
            </div>
          )}
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          {done && !error && <p role="status" className="text-sm text-green-700">
              {converting
                ? 'Reel uploaded. We are converting the video so it plays on every phone. It goes live by itself in a minute or two (see the Converting tab).'
                : 'Reel published. It is now in the Live tab.'}
            </p>}

          <button type="button" onClick={submit} disabled={busy}
            className="w-full rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-60 sm:w-auto">
            {busy ? 'Please wait…' : 'Publish reel'}
          </button>
        </div>
      </div>
    </section>
  );
}
