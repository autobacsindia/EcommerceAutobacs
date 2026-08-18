'use client';

import { useCallback, useEffect, useState } from 'react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { uploadImageToCloudinary } from '@/lib/cloudinaryUpload';

/**
 * Admin — site-wide promo banner.
 *
 * Marketing swaps the occasion artwork here: upload, point it somewhere, switch
 * it on. Several banners can be prepared ahead of time; exactly one renders, and
 * the resolution rule is the backend's — this screen only ever reports what the
 * backend decided (`liveId`), it never re-derives "which one is showing".
 */

interface Banner {
  _id: string;
  title: string;
  imageUrl: string;
  imagePublicId: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  alt: string;
  linkPath: string;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  priority: number;
  createdAt: string;
}

type Draft = {
  title: string;
  imageUrl: string;
  imagePublicId: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  alt: string;
  linkPath: string;
  isActive: boolean;
  startsAt: string;
  endsAt: string;
  priority: number;
};

const EMPTY: Draft = {
  title: '',
  imageUrl: '',
  imagePublicId: null,
  imageWidth: null,
  imageHeight: null,
  alt: '',
  linkPath: '/offers',
  isActive: false,
  startsAt: '',
  endsAt: '',
  priority: 0,
};

const label = 'block text-sm font-medium text-gray-700 mb-1';
const input = 'w-full border border-gray-300 rounded-lg px-3 py-2';
const hint = 'mt-1 text-xs text-gray-500';

/**
 * A `datetime-local` input speaks naive local time; the API speaks ISO.
 * Converting through the Date object keeps the admin's own clock authoritative,
 * which is what "starts at midnight" means to the person typing it.
 */
const toInputValue = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromInputValue = (value: string) => (value ? new Date(value).toISOString() : null);

const toDraft = (b: Banner): Draft => ({
  title: b.title,
  imageUrl: b.imageUrl,
  imagePublicId: b.imagePublicId,
  imageWidth: b.imageWidth,
  imageHeight: b.imageHeight,
  alt: b.alt,
  linkPath: b.linkPath,
  isActive: b.isActive,
  startsAt: toInputValue(b.startsAt),
  endsAt: toInputValue(b.endsAt),
  priority: b.priority,
});

export default function AdminPromoBannersPage() {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [liveId, setLiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // The admin list and the live banner come from two endpoints on purpose:
      // the second is the storefront's own resolution, so the "LIVE" tag below
      // reflects what shoppers actually see rather than this page's guess at it.
      const [list, active] = await Promise.all([
        apiClient.get<{ success: boolean; banners: Banner[] }>(API_ENDPOINTS.PROMO_BANNERS_ADMIN),
        apiClient.get<{ success: boolean; banner: { id: string } | null }>(API_ENDPOINTS.PROMO_BANNER_ACTIVE),
      ]);
      setBanners(list.banners || []);
      setLiveId(active.banner?.id ?? null);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load banners');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((p) => ({ ...p, [k]: v }));

  const openCreate = () => { setEditingId(null); setDraft(EMPTY); setShowForm(true); setMsg(null); setError(null); };
  const openEdit = (b: Banner) => { setEditingId(b._id); setDraft(toDraft(b)); setShowForm(true); setMsg(null); setError(null); };
  const closeForm = () => { setShowForm(false); setEditingId(null); setDraft(EMPTY); };

  const handleUpload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      // Uploads straight to Cloudinary using a signature minted by our backend —
      // the bytes never pass through the API, so there is no ~4.5 MB proxy cap.
      // width/height come back in the same response and are stored so the
      // storefront can reserve the strip's space before the image loads.
      const { url, public_id, width, height } = await uploadImageToCloudinary(file, 'promos');
      setDraft((p) => ({
        ...p,
        imageUrl: url,
        imagePublicId: public_id,
        imageWidth: width ?? null,
        imageHeight: height ?? null,
      }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    setError(null);
    try {
      const payload = {
        ...draft,
        startsAt: fromInputValue(draft.startsAt),
        endsAt: fromInputValue(draft.endsAt),
        priority: Number(draft.priority) || 0,
      };
      if (editingId) {
        await apiClient.put(API_ENDPOINTS.PROMO_BANNER_ADMIN_BY_ID(editingId), payload);
        setMsg('Banner updated. The storefront refreshes within a few seconds.');
      } else {
        await apiClient.post(API_ENDPOINTS.PROMO_BANNERS_ADMIN, payload);
        setMsg('Banner created.');
      }
      closeForm();
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (b: Banner) => {
    setError(null);
    try {
      await apiClient.patch(API_ENDPOINTS.PROMO_BANNER_TOGGLE(b._id), { isActive: !b.isActive });
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    }
  };

  const remove = async (b: Banner) => {
    // Deletes the Cloudinary artwork too, so it genuinely cannot be undone.
    if (!window.confirm(`Delete "${b.title}"? This also removes its uploaded images.`)) return;
    setError(null);
    try {
      await apiClient.delete(API_ENDPOINTS.PROMO_BANNER_ADMIN_BY_ID(b._id));
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  return (
    <div className="p-8">
      <div className="flex items-start justify-between mb-2">
        <h1 className="text-3xl font-bold">Promo Banner</h1>
        <button onClick={openCreate} className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700">
          + New banner
        </button>
      </div>
      <p className="text-gray-500 mb-6 max-w-3xl text-sm">
        The strip across the top of the storefront. Only one banner shows at a time — the
        active one with the highest priority, inside its date window. Everything else waits
        its turn, so next month&apos;s campaign can be prepared in advance.
      </p>

      {msg && <div className="mb-4 bg-green-50 border border-green-200 text-green-700 rounded-lg px-3 py-2 text-sm">{msg}</div>}
      {error && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">{error}</div>}

      {showForm && (
        <form onSubmit={save} className="mb-8 max-w-3xl space-y-5 bg-white p-6 rounded-lg shadow">
          <h2 className="text-lg font-semibold">{editingId ? 'Edit banner' : 'New banner'}</h2>

          <div>
            <label className={label}>Name (internal)</label>
            <input className={input} value={draft.title} required maxLength={120}
              onChange={(e) => set('title', e.target.value)} placeholder="Onam 2026" />
            <p className={hint}>Only you see this — it never appears on the site.</p>
          </div>

          <div>
            <label className={label}>Banner image *</label>
            <input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(f); }} />
            {uploading && <p className={hint}>Uploading…</p>}

            {draft.imageUrl && (
              <div className="mt-3 space-y-3">
                <div>
                  <p className="text-xs font-medium text-gray-600 mb-1">Desktop (full width)</p>
                  {/* eslint-disable-next-line @next/next/no-img-element -- admin-only preview of an arbitrary Cloudinary upload */}
                  <img src={draft.imageUrl} alt="Banner preview" className="w-full rounded border border-gray-200" />
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-600 mb-1">Phone (about 375px wide)</p>
                  {/* The same image at phone width. It scales down whole — nothing is
                      cropped — so this is exactly what a mobile visitor sees, and it is
                      the check for whether the wording is still readable. */}
                  <div className="w-[375px] max-w-full rounded border border-gray-200 overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element -- admin-only preview */}
                    <img src={draft.imageUrl} alt="Banner preview at phone width" className="w-full block" />
                  </div>
                </div>
              </div>
            )}

            <p className={hint}>
              A wide strip — around 1600×100 works well. It is shown whole and scales with the
              screen, so nothing gets cut off; check the phone preview above and make sure the
              text is still readable at that size.
              {draft.imageWidth && draft.imageHeight && (
                <> Uploaded at {draft.imageWidth}×{draft.imageHeight}.</>
              )}
            </p>
          </div>

          <div>
            <label className={label}>Alt text *</label>
            <input className={input} value={draft.alt} required maxLength={200}
              onChange={(e) => set('alt', e.target.value)} placeholder="Onam offer is live — shop now" />
            <p className={hint}>
              Read aloud by screen readers and shown if the image fails to load. The banner&apos;s
              wording lives inside the picture, so this is the only version some visitors get.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label}>Clicking it goes to</label>
              <input className={input} value={draft.linkPath}
                onChange={(e) => set('linkPath', e.target.value)} placeholder="/offers" />
              <p className={hint}>A path on this site, starting with &quot;/&quot;. Defaults to /offers.</p>
            </div>
            <div>
              <label className={label}>Priority</label>
              <input type="number" className={input} value={draft.priority}
                onChange={(e) => set('priority', Number(e.target.value))} />
              <p className={hint}>Higher wins if two banners are live at once.</p>
            </div>
            <div>
              <label className={label}>Starts (optional)</label>
              <input type="datetime-local" className={input} value={draft.startsAt}
                onChange={(e) => set('startsAt', e.target.value)} />
            </div>
            <div>
              <label className={label}>Ends (optional)</label>
              <input type="datetime-local" className={input} value={draft.endsAt}
                onChange={(e) => set('endsAt', e.target.value)} />
            </div>
          </div>
          <p className={hint}>
            Leave the dates blank to run until you switch it off. Scheduling only controls when it
            shows — the banner is never deleted when it ends, so you can reuse it next year.
          </p>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={draft.isActive} onChange={(e) => set('isActive', e.target.checked)} />
            Active
          </label>

          <div className="flex gap-3">
            <button type="submit" disabled={saving || uploading || !draft.imageUrl}
              className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create banner'}
            </button>
            <button type="button" onClick={closeForm} className="border border-gray-300 rounded-lg px-4 py-2 text-sm">
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="text-gray-500">Loading…</div>
      ) : banners.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          No banners yet. Create one to run a campaign strip across the site.
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow divide-y">
          {banners.map((b) => (
            <div key={b._id} className="flex items-center gap-4 p-4">
              {/* eslint-disable-next-line @next/next/no-img-element -- admin-only thumbnail */}
              <img src={b.imageUrl} alt="" className="h-10 w-40 rounded object-cover border border-gray-200" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">{b.title}</span>
                  {b._id === liveId && (
                    <span className="shrink-0 rounded-full bg-green-100 text-green-700 text-[11px] font-semibold px-2 py-0.5">
                      LIVE
                    </span>
                  )}
                  {b.isActive && b._id !== liveId && (
                    <span className="shrink-0 rounded-full bg-amber-100 text-amber-700 text-[11px] font-semibold px-2 py-0.5">
                      ON — NOT SHOWING
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500 truncate">
                  → {b.linkPath}
                  {b.startsAt && ` · from ${new Date(b.startsAt).toLocaleString('en-IN')}`}
                  {b.endsAt && ` · until ${new Date(b.endsAt).toLocaleString('en-IN')}`}
                  {b.priority !== 0 && ` · priority ${b.priority}`}
                </div>
              </div>
              <button onClick={() => toggle(b)}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium ${
                  b.isActive ? 'bg-gray-200 text-gray-800 hover:bg-gray-300' : 'bg-green-600 text-white hover:bg-green-700'
                }`}>
                {b.isActive ? 'Turn off' : 'Turn on'}
              </button>
              <button onClick={() => openEdit(b)} className="shrink-0 border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
                Edit
              </button>
              <button onClick={() => remove(b)} className="shrink-0 text-red-600 text-sm hover:underline">
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
