'use client';

import { useCallback, useEffect, useState } from 'react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { uploadImageToCloudinary } from '@/lib/cloudinaryUpload';
import { PROMO_SLOT_SPECS, promoAspectRatio, PROMO_MAX_HEIGHT } from '@/components/layout/PromoBanner';

/**
 * Admin — site-wide promo banner.
 *
 * Marketing swaps the occasion artwork here: upload, point it somewhere, switch
 * it on. Several banners can be prepared ahead of time; exactly one renders, and
 * the resolution rule is the backend's — this screen only reports the `state` the
 * backend computed, it never re-derives "which one is showing".
 *
 * ONE artwork file is all this needs. The strip renders it whole — full width,
 * height following the file's own shape — so nothing is ever cropped.
 *
 * The two extra slots exist for a single reason: a wide strip gets proportionally
 * shorter as the screen narrows, so a 15:1 desktop file is a ~25px sliver on a
 * phone. Uploading a squatter file for the small breakpoints fixes that. They are
 * optional, hidden until asked for, and fall back to the desktop file.
 */

/** Which artwork slot a file belongs to. Order = the order shown in the form. */
const SLOTS = ['desktop', 'tablet', 'mobile'] as const;
type Slot = (typeof SLOTS)[number];

/** Everything except the required desktop file — shown behind a disclosure. */
const OPTIONAL_SLOTS: Slot[] = ['tablet', 'mobile'];

/** API field names per slot. Desktop keeps the original flat `image*` names. */
const SLOT_FIELDS: Record<Slot, { url: string; publicId: string; width: string; height: string }> = {
  desktop: { url: 'imageUrl', publicId: 'imagePublicId', width: 'imageWidth', height: 'imageHeight' },
  tablet: { url: 'tabletImageUrl', publicId: 'tabletImagePublicId', width: 'tabletImageWidth', height: 'tabletImageHeight' },
  mobile: { url: 'mobileImageUrl', publicId: 'mobileImagePublicId', width: 'mobileImageWidth', height: 'mobileImageHeight' },
};

/** Why a banner is or isn't on screen — computed server-side, never re-derived here. */
type BannerState = 'live' | 'off' | 'scheduled' | 'ended' | 'superseded';

interface SlotImage {
  url: string;
  publicId: string | null;
  width: number | null;
  height: number | null;
}

interface Banner {
  _id: string;
  state: BannerState;
  title: string;
  alt: string;
  linkPath: string;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  priority: number;
  createdAt: string;
  [field: string]: unknown;
}

type Draft = {
  title: string;
  alt: string;
  linkPath: string;
  isActive: boolean;
  startsAt: string;
  endsAt: string;
  priority: number;
  images: Record<Slot, SlotImage>;
};

const EMPTY_SLOT: SlotImage = { url: '', publicId: null, width: null, height: null };

const EMPTY: Draft = {
  title: '',
  alt: '',
  linkPath: '/offers',
  isActive: false,
  startsAt: '',
  endsAt: '',
  priority: 0,
  images: { desktop: { ...EMPTY_SLOT }, tablet: { ...EMPTY_SLOT }, mobile: { ...EMPTY_SLOT } },
};

/**
 * Badge copy per state.
 *
 * The first version of this screen said "ON — NOT SHOWING", which told an
 * operator that something was wrong without telling them what, and left them
 * staring at a ticked Active box. Each label below names the actual blocker so
 * the next action is obvious.
 */
const STATE_BADGE: Record<BannerState, { text: string; className: string; explain: string }> = {
  live: { text: 'LIVE', className: 'bg-green-100 text-green-700', explain: 'Showing on the site right now.' },
  scheduled: { text: 'SCHEDULED', className: 'bg-blue-100 text-blue-700', explain: 'Active, but its start date/time has not arrived yet.' },
  ended: { text: 'ENDED', className: 'bg-gray-200 text-gray-700', explain: 'Active, but its end date has passed. Clear or extend the end date to run it again.' },
  superseded: { text: 'WAITING', className: 'bg-amber-100 text-amber-800', explain: 'Active and in date, but another banner has a higher priority. Raise its priority or turn the other one off.' },
  off: { text: 'OFF', className: 'bg-gray-100 text-gray-500', explain: 'Switched off.' },
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
  alt: b.alt,
  linkPath: b.linkPath,
  isActive: b.isActive,
  startsAt: toInputValue(b.startsAt),
  endsAt: toInputValue(b.endsAt),
  priority: b.priority,
  images: SLOTS.reduce((acc, slot) => {
    const f = SLOT_FIELDS[slot];
    acc[slot] = {
      url: (b[f.url] as string) || '',
      publicId: (b[f.publicId] as string) ?? null,
      width: (b[f.width] as number) ?? null,
      height: (b[f.height] as number) ?? null,
    };
    return acc;
  }, {} as Record<Slot, SlotImage>),
});

/** Flatten the slot map back onto the API's field names. */
const toPayload = (draft: Draft) => {
  const out: Record<string, unknown> = {
    title: draft.title,
    alt: draft.alt,
    linkPath: draft.linkPath,
    isActive: draft.isActive,
    priority: Number(draft.priority) || 0,
    startsAt: fromInputValue(draft.startsAt),
    endsAt: fromInputValue(draft.endsAt),
  };
  for (const slot of SLOTS) {
    const f = SLOT_FIELDS[slot];
    const img = draft.images[slot];
    out[f.url] = img.url || null;
    out[f.publicId] = img.publicId;
    out[f.width] = img.width;
    out[f.height] = img.height;
  }
  return out;
};

/** How far off-spec an upload may be before we say something. */
const SIZE_TOLERANCE = 0.9;

export default function AdminPromoBannersPage() {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<Slot | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // One request. Each row's `state` is computed server-side against the same
      // query the storefront uses — an earlier version also polled the PUBLIC
      // /active endpoint, which carries CDN cache headers and so could hand the
      // admin a stale verdict about a change they had just saved.
      const list = await apiClient.get<{ success: boolean; banners: Banner[] }>(
        API_ENDPOINTS.PROMO_BANNERS_ADMIN,
      );
      setBanners(list.banners || []);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load banners');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((p) => ({ ...p, [k]: v }));

  /**
   * Whether the optional-artwork disclosure is open.
   *
   * Controlled rather than left to the browser: it has to spring open when the
   * banner being edited already uses those slots, or an operator would open a
   * banner, see one upload box, and reasonably conclude the other files were
   * lost. Kept in state (not derived inline) so re-renders from unrelated typing
   * can't force it back open after the operator closes it.
   */
  const [showOptionalArt, setShowOptionalArt] = useState(false);
  const usesOptionalArt = (d: Draft) => OPTIONAL_SLOTS.some((slot) => Boolean(d.images[slot].url));

  const openCreate = () => { setEditingId(null); setDraft(EMPTY); setShowOptionalArt(false); setShowForm(true); setMsg(null); setError(null); };
  const openEdit = (b: Banner) => { const d = toDraft(b); setEditingId(b._id); setDraft(d); setShowOptionalArt(usesOptionalArt(d)); setShowForm(true); setMsg(null); setError(null); };
  const closeForm = () => { setShowForm(false); setEditingId(null); setDraft(EMPTY); };

  const handleUpload = async (file: File, slot: Slot) => {
    setUploading(slot);
    setError(null);
    try {
      // Straight to Cloudinary using a signature minted by our backend — the
      // bytes never pass through the API, so there is no ~4.5 MB proxy cap.
      // width/height come back in the same response and drive the size check.
      const { url, public_id, width, height } = await uploadImageToCloudinary(file, 'promos');
      setDraft((p) => ({
        ...p,
        images: { ...p.images, [slot]: { url, publicId: public_id, width: width ?? null, height: height ?? null } },
      }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(null);
    }
  };

  const clearSlot = (slot: Slot) =>
    setDraft((p) => ({ ...p, images: { ...p.images, [slot]: { ...EMPTY_SLOT } } }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    setError(null);
    try {
      const payload = toPayload(draft);
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

  /** One upload slot: spec, file picker, preview at true rendered height, size check. */
  const renderSlot = (slot: Slot) => {
    const spec = PROMO_SLOT_SPECS[slot];
    const img = draft.images[slot];
    const required = slot === 'desktop';
    const undersized = img.width != null && img.width < spec.width * SIZE_TOLERANCE;

    return (
      <div key={slot} className="rounded-lg border border-gray-200 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <label className={label}>
            {spec.label} {required ? '*' : <span className="font-normal text-gray-400">(optional)</span>}
          </label>
          <span className="text-xs text-gray-500">shows on {spec.minViewport}</span>
        </div>

        <p className="mb-2 text-xs font-medium text-blue-700">
          Give your designer: <strong>{spec.width} × {spec.height} px</strong>
          <span className="font-normal text-gray-500">
            {' '}({spec.ratio}:1). Nothing is cropped — the strip is as tall as this
            shape makes it, about 100px on a typical {spec.label.toLowerCase()} screen.
          </span>
        </p>

        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={uploading !== null}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(f, slot); }}
        />
        {uploading === slot && <p className={hint}>Uploading…</p>}

        {img.url && (
          <div className="mt-3">
            {/* Reserved and filled exactly as the storefront does it — same
                aspect-ratio helper, same object-contain — so the preview cannot
                flatter a file that will letterbox or look soft in production. */}
            <div
              className="w-full overflow-hidden rounded border border-gray-200 bg-gray-900"
              style={{
                aspectRatio: promoAspectRatio(slot, img.width, img.height),
                maxHeight: PROMO_MAX_HEIGHT,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- admin-only preview of an arbitrary Cloudinary upload */}
              <img src={img.url} alt={`${spec.label} preview`} className="h-full w-full object-contain object-center" />
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-xs text-gray-500">
                {img.width && img.height
                  ? `Uploaded ${img.width}×${img.height} (${(img.width / img.height).toFixed(1)}:1)`
                  : 'Uploaded'}
              </span>
              {!required && (
                <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => clearSlot(slot)}>
                  Remove
                </button>
              )}
            </div>
          </div>
        )}

        {/* Caught at upload time rather than in production: an under-sized file
            looks fine in a small preview and only turns soft once stretched. */}
        {undersized && (
          <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <strong>This will look blurry.</strong> It is {img.width}px wide; this slot needs{' '}
            <strong>{spec.width}px</strong>. Re-export the artwork larger — enlarging the existing
            file will not help. You can still save.
          </p>
        )}

        {!img.url && !required && (
          <p className={hint}>Leave empty to reuse the desktop image at this size.</p>
        )}
      </div>
    );
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

          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-800">Artwork</h3>
              <p className="text-xs text-gray-500">
                One image is enough. It fills the screen width and is never cropped — the
                strip is simply as tall as the image&apos;s shape makes it, so a wide design
                looks the same on every monitor and gets shorter as the screen narrows.
              </p>
            </div>

            {renderSlot('desktop')}

            {/* Collapsed by default: three upload boxes read as three things you
                must produce. They are one thing you must produce plus an escape
                hatch for phones, and the copy should say so before it asks for
                files. */}
            <details
              className="rounded-lg border border-gray-200 bg-gray-50 p-4"
              open={showOptionalArt}
              onToggle={(e) => setShowOptionalArt(e.currentTarget.open)}
            >
              <summary className="cursor-pointer text-sm font-medium text-gray-800">
                Add separate artwork for smaller screens (optional)
              </summary>
              <p className="mt-2 mb-3 text-xs text-gray-500">
                Only worth doing if the wide design ends up too short to read on a phone: a{' '}
                {PROMO_SLOT_SPECS.desktop.ratio}:1 strip is about{' '}
                {Math.round(390 / PROMO_SLOT_SPECS.desktop.ratio)}px tall on one. A squatter
                design for these sizes keeps the wording legible. Leave them empty and the
                desktop image is used everywhere.
              </p>
              <div className="space-y-3">{OPTIONAL_SLOTS.map(renderSlot)}</div>
            </details>
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
            <button type="submit" disabled={saving || uploading !== null || !draft.images.desktop.url}
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
              <img src={b.imageUrl as string} alt="" className="h-10 w-40 rounded object-cover border border-gray-200" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">{b.title}</span>
                  <span className={`shrink-0 rounded-full text-[11px] font-semibold px-2 py-0.5 ${STATE_BADGE[b.state].className}`}>
                    {STATE_BADGE[b.state].text}
                  </span>
                </div>
                {/* Say why, not just what — an unexplained "not showing" is the
                    thing that sends someone to ask an engineer. */}
                {b.state !== 'live' && (
                  <div className="text-xs text-gray-600">{STATE_BADGE[b.state].explain}</div>
                )}
                <div className="text-xs text-gray-500 truncate">
                  → {b.linkPath}
                  {b.startsAt && ` · from ${new Date(b.startsAt).toLocaleString('en-IN')}`}
                  {b.endsAt && ` · until ${new Date(b.endsAt).toLocaleString('en-IN')}`}
                  {b.priority !== 0 && ` · priority ${b.priority}`}
                  {!b.mobileImageUrl && ' · ⚠ no mobile artwork'}
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
