'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import apiClient, { ApiError } from '@/lib/api';
import { uploadImageToCloudinary } from '@/lib/cloudinaryUpload';
import { API_ENDPOINTS } from '@/lib/constants';
import { formatDateTimeIST } from '@/lib/datetime';
import type { SpinCampaign, SpinPrize, OddsPreview, PublishFieldError, PrizeKind } from '@/types/spin';

/**
 * Admin — one Spin-to-Win campaign: its prizes, its real odds, and the publish gate.
 *
 * Two things here are load-bearing and worth not "simplifying" later:
 *
 * 1. The odds table is COMPUTED BY THE BACKEND, never re-derived in the browser. If this
 *    screen calculated its own probabilities they would drift from the ones the draw
 *    actually uses, and an operator would be tuning against a number that isn't real.
 *
 * 2. Publish failures are rendered as NAMED FIELDS. The backend refuses to return a bare
 *    "Validation Error" precisely so this screen can point at the broken thing; showing
 *    only a generic message would throw that away and make a misconfigured campaign
 *    undiagnosable from the UI.
 */

const KIND_LABEL: Record<PrizeKind, string> = {
  goodie: 'Physical goodie',
  coupon: 'Discount coupon',
  karma: 'Karma points',
};

const emptyPrize = () => ({
  name: '',
  shortLabel: '',
  sku: '',
  kind: 'goodie' as PrizeKind,
  stockTotal: 10 as number | null,
  minOrderValueRupees: 0,
  maxWinsPerDay: null as number | null,
  isFloorPrize: false,
  couponType: 'fixed' as 'percentage' | 'fixed' | 'free_shipping',
  couponValue: 200,
  couponValidDays: 30,
  couponMinCartValue: 0,
  karmaPoints: 0,
  imageUrl: null as string | null,
});

export default function SpinCampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [campaign, setCampaign] = useState<SpinCampaign | null>(null);
  const [prizes, setPrizes] = useState<SpinPrize[]>([]);
  const [odds, setOdds] = useState<OddsPreview | null>(null);
  const [ordersPerDay, setOrdersPerDay] = useState(50);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [publishErrors, setPublishErrors] = useState<PublishFieldError[]>([]);
  const [busy, setBusy] = useState(false);

  const [showPrizeForm, setShowPrizeForm] = useState(false);
  const [prizeForm, setPrizeForm] = useState(emptyPrize());
  /** null = the form is creating; an id = the form is editing that prize. */
  const [editingPrizeId, setEditingPrizeId] = useState<string | null>(null);
  // The prize form is rendered once, inside the Goodies section, and serves the
  // guaranteed prize too — so opening it from the panel above would otherwise scroll
  // nothing and look like the button did nothing at all.
  const prizeFormRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cRes, pRes] = await Promise.all([
        apiClient.get<{ success: boolean; campaigns: SpinCampaign[] }>(API_ENDPOINTS.SPIN_CAMPAIGNS_ADMIN),
        apiClient.get<{ success: boolean; prizes: SpinPrize[] }>(API_ENDPOINTS.SPIN_CAMPAIGN_PRIZES(id)),
      ]);
      setCampaign((cRes.campaigns ?? []).find((c) => c._id === id) ?? null);
      setPrizes(pRes.prizes ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load campaign');
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadOdds = useCallback(async () => {
    try {
      const res = await apiClient.get<OddsPreview & { success: boolean }>(
        `${API_ENDPOINTS.SPIN_CAMPAIGN_ODDS(id)}?paidOrdersPerDay=${ordersPerDay}`,
      );
      setOdds(res);
    } catch {
      setOdds(null); // odds are advisory — a failure here must not block the screen
    }
  }, [id, ordersPerDay]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!loading) void loadOdds(); }, [loading, prizes, loadOdds]);

  /**
   * Load an existing prize into the shared form.
   *
   * Until this existed the only edits possible were restock and deactivate, so a coupon
   * created with the wrong discount could only be fixed by deactivating it and building
   * a replacement — on a live campaign that briefly leaves the wheel with no guaranteed
   * prize at all.
   */
  const openEdit = (p: SpinPrize) => {
    setEditingPrizeId(p._id);
    setShowPrizeForm(true);
    setError(null);
    setPrizeForm({
      name: p.name,
      shortLabel: p.shortLabel || '',
      sku: p.sku || '',
      kind: p.kind,
      stockTotal: p.stockTotal,
      minOrderValueRupees: (p.minOrderValuePaise || 0) / 100,
      maxWinsPerDay: p.maxWinsPerDay ?? null,
      isFloorPrize: p.isFloorPrize,
      couponType: p.couponType ?? 'fixed',
      couponValue: p.couponValue ?? 0,
      couponValidDays: p.couponValidDays ?? 30,
      couponMinCartValue: p.couponMinCartValue ?? 0,
      karmaPoints: p.karmaPoints ?? 0,
      imageUrl: p.imageUrl ?? null,
    });
  };

  useEffect(() => {
    if (showPrizeForm) {
      prizeFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [showPrizeForm, editingPrizeId]);

  const [uploading, setUploading] = useState(false);

  /**
   * Upload the prize picture straight to Cloudinary and keep only the URL.
   *
   * Same signed direct-upload path the product gallery uses — bytes never cross our API,
   * which is what keeps this under Vercel's ~4.5 MB request cap.
   */
  const uploadPrizeImage = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const img = await uploadImageToCloudinary(file, 'spin');
      setPrizeForm((f) => ({ ...f, imageUrl: img.url }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Image upload failed');
    } finally {
      setUploading(false);
    }
  };

  const closePrizeForm = () => {
    setShowPrizeForm(false);
    setEditingPrizeId(null);
    setPrizeForm(emptyPrize());
  };

  /**
   * Save an EXISTING prize.
   *
   * Deliberately does not send stock: `stockRemaining` is server-owned (the validator
   * rejects it outright) and `stockTotal` has restock semantics of its own, so stock
   * stays with the Restock action rather than being silently rewritten by an edit that
   * was only meant to change a discount. Structural changes the backend refuses on a
   * live campaign (swapping the prize type, moving the guaranteed flag) surface as the
   * server's own message rather than being guessed at here.
   */
  const updatePrizeFields = async () => {
    if (!editingPrizeId) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.put(API_ENDPOINTS.SPIN_PRIZE_BY_ID(editingPrizeId), {
        name: prizeForm.name.trim(),
        shortLabel: prizeForm.shortLabel.trim() || null,
        sku: prizeForm.kind === 'goodie' ? prizeForm.sku.trim() : null,
        minOrderValuePaise: Math.round(Number(prizeForm.minOrderValueRupees || 0) * 100),
        maxWinsPerDay: prizeForm.maxWinsPerDay,
        ...(prizeForm.kind === 'coupon' ? {
          couponType: prizeForm.couponType,
          couponValue: Number(prizeForm.couponValue),
          couponValidDays: Number(prizeForm.couponValidDays),
          couponMinCartValue: Number(prizeForm.couponMinCartValue),
        } : {}),
        ...(prizeForm.kind === 'karma' ? { karmaPoints: Number(prizeForm.karmaPoints) } : {}),
        imageUrl: prizeForm.imageUrl,
      });
      setMsg('Prize updated. Coupons already issued to past winners keep the old value.');
      closePrizeForm();
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update prize');
    } finally {
      setBusy(false);
    }
  };

  const addPrize = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiClient.post(API_ENDPOINTS.SPIN_CAMPAIGN_PRIZES(id), {
        name: prizeForm.name.trim(),
        shortLabel: prizeForm.shortLabel.trim() || null,
        kind: prizeForm.kind,
        sku: prizeForm.kind === 'goodie' ? prizeForm.sku.trim() : null,
        // The floor prize is the guaranteed win, so it must be unlimited: sending null
        // stock is what makes "everyone wins" true once the goodies run out.
        stockTotal: prizeForm.isFloorPrize ? null : Number(prizeForm.stockTotal ?? 0),
        minOrderValuePaise: Math.round(Number(prizeForm.minOrderValueRupees || 0) * 100),
        maxWinsPerDay: prizeForm.maxWinsPerDay,
        isFloorPrize: prizeForm.isFloorPrize,
        ...(prizeForm.kind === 'coupon' ? {
          couponType: prizeForm.couponType,
          couponValue: Number(prizeForm.couponValue),
          couponValidDays: Number(prizeForm.couponValidDays),
          couponMinCartValue: Number(prizeForm.couponMinCartValue),
        } : {}),
        karmaPoints: prizeForm.kind === 'karma' ? Number(prizeForm.karmaPoints) : 0,
        imageUrl: prizeForm.imageUrl,
      });
      setMsg('Prize added.');
      closePrizeForm();
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add prize');
    } finally {
      setBusy(false);
    }
  };

  const restock = async (prize: SpinPrize, newTotal: number) => {
    setBusy(true);
    setError(null);
    try {
      await apiClient.put(API_ENDPOINTS.SPIN_PRIZE_BY_ID(prize._id), { stockTotal: newTotal });
      setMsg(`${prize.name} restocked.`);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to restock');
    } finally {
      setBusy(false);
    }
  };

  const removePrize = async (prize: SpinPrize) => {
    if (!confirm(`Remove "${prize.name}" from this campaign?`)) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.delete(API_ENDPOINTS.SPIN_PRIZE_BY_ID(prize._id));
      setMsg(`${prize.name} removed.`);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to remove prize');
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    setBusy(true);
    setError(null);
    setPublishErrors([]);
    try {
      await apiClient.post(API_ENDPOINTS.SPIN_CAMPAIGN_PUBLISH(id), {});
      setMsg('Campaign is LIVE. Customers will see the wheel after paying.');
      await load();
    } catch (err: unknown) {
      // 422 carries the named field errors from the safety gate; surface them verbatim
      // rather than collapsing to "something went wrong".
      const raw = (err as ApiError)?.rawData as { errors?: PublishFieldError[] } | undefined;
      if (raw?.errors?.length) setPublishErrors(raw.errors);
      else setError(err instanceof Error ? err.message : 'Could not publish');
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (status: 'off' | 'draft') => {
    setBusy(true);
    setError(null);
    try {
      await apiClient.patch(API_ENDPOINTS.SPIN_CAMPAIGN_STATUS(id), { status });
      setMsg(status === 'off' ? 'Campaign switched OFF. The wheel is gone immediately.' : 'Back to draft.');
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to change status');
    } finally {
      setBusy(false);
    }
  };

  const clone = async () => {
    const slug = prompt('Slug for the new campaign (url-safe, must be unique):', `${campaign?.slug ?? ''}-next`);
    if (!slug) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient.post<{ success: boolean; campaign: SpinCampaign }>(
        API_ENDPOINTS.SPIN_CAMPAIGN_CLONE(id), { slug: slug.trim() },
      );
      router.push(`/admin/spin/${res.campaign._id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to clone');
      setBusy(false);
    }
  };

  if (loading) return <div className="p-6 text-gray-500">Loading…</div>;
  if (!campaign) return <div className="p-6 text-gray-500">Campaign not found.</div>;

  const floor = prizes.find((p) => p.isFloorPrize && p.active);
  const goodies = prizes.filter((p) => !p.isFloorPrize && p.active);

  return (
    <div className="p-6">
      <Link href="/admin/spin" className="text-sm text-blue-600 hover:underline">← All campaigns</Link>

      <div className="mt-2 mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{campaign.name}</h1>
          <p className="text-sm text-gray-500">
            {campaign.slug} · {formatDateTimeIST(campaign.startsAt)} → {formatDateTimeIST(campaign.endsAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {campaign.status !== 'live' && (
            <button onClick={publish} disabled={busy}
              className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50">
              ▶ Publish (go live)
            </button>
          )}
          {campaign.status === 'live' && (
            <button onClick={() => setStatus('off')} disabled={busy}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              title="Stops the wheel instantly, including spins already in progress">
              ■ Switch OFF now
            </button>
          )}
          <button onClick={clone} disabled={busy}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            title="Open a NEW window. Never re-run a campaign by editing its dates.">
            ⧉ Clone for next window
          </button>
        </div>
      </div>

      {/* Re-running a campaign by editing its dates silently locks out every customer who
          already spun, because the per-customer cap counts against this campaign's id. */}
      {campaign.status === 'live' && campaign.maxSpinsPerUserPerCampaign !== null && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Running it again later?</strong> Use <em>Clone for next window</em> — don&apos;t just
          change the dates here. Each customer&apos;s {campaign.maxSpinsPerUserPerCampaign}-spin limit is
          counted against <em>this</em> campaign, so reusing it would leave everyone who already
          spun permanently locked out, with no error to tell you.
        </div>
      )}

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {msg && <div className="mb-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">{msg}</div>}

      {publishErrors.length > 0 && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <p className="font-semibold text-red-800">This campaign can&apos;t go live yet:</p>
          <ul className="mt-2 space-y-1 text-sm text-red-700">
            {publishErrors.map((e, i) => (
              <li key={i}>
                <code className="rounded bg-red-100 px-1 text-xs">{e.field}</code> — {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── The guaranteed prize ─────────────────────────────────────────────── */}
      <section className="mb-6 rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Guaranteed prize (everyone wins this if they don&apos;t win a goodie)</h2>
          {!floor && (
            /*
              This button exists because the only way to create the guaranteed prize used
              to be the "+ Add prize" button over in the Goodies section, with the Type
              dropdown switched to "Discount coupon" and a checkbox ticked further down
              the form. The discount amount only appears once Type is a coupon, so anyone
              who did not find that dropdown concluded there was no way to set the coupon
              value at all — and without it the campaign can never pass the publish gate.
            */
            <button
              onClick={() => { setPrizeForm({ ...emptyPrize(), kind: 'coupon', isFloorPrize: true, stockTotal: null }); setShowPrizeForm(true); }}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
              + Set up the guaranteed prize
            </button>
          )}
        </div>
        {floor ? (
          <div className="mt-3 flex items-center justify-between rounded-lg bg-indigo-50 px-4 py-3">
            <div>
              <div className="font-medium text-indigo-900">{floor.name}</div>
              <div className="text-xs text-indigo-700">
                {KIND_LABEL[floor.kind]}
                {/* Surfaced so the actual discount is verifiable without reopening a form. */}
                {floor.kind === 'coupon' && (
                  <> · {floor.couponType === 'free_shipping'
                    ? 'free shipping'
                    : floor.couponType === 'percentage'
                      ? `${floor.couponValue}% off`
                      : `₹${floor.couponValue} off`}
                    {floor.couponMinCartValue ? ` · min cart ₹${floor.couponMinCartValue}` : ''}
                    {floor.couponValidDays ? ` · valid ${floor.couponValidDays} days` : ''}
                  </>
                )}
                {' '}· unlimited · awarded {floor.stockAwarded} times
              </div>
            </div>
            <div className="flex items-center gap-3">
              {/* The reason this whole edit path exists: a wrong discount here used to be
                  unfixable without deactivating the guaranteed prize on a live campaign. */}
              <button onClick={() => openEdit(floor)} className="text-sm font-medium text-indigo-700 hover:underline">
                Edit
              </button>
              <span className="rounded-full bg-indigo-600 px-2.5 py-0.5 text-xs font-semibold text-white">FALLBACK</span>
            </div>
          </div>
        ) : (
          <p className="mt-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            ⚠️ Missing. The campaign cannot go live without it — once the goodies run out the
            wheel would have nothing to award. Use the button above; it is normally a discount
            coupon, and you set the amount there.
          </p>
        )}
      </section>

      {/* ── Goodies ──────────────────────────────────────────────────────────── */}
      <section className="mb-6 rounded-xl border border-gray-200 bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Goodies ({goodies.length})</h2>
          <button onClick={() => (showPrizeForm ? closePrizeForm() : setShowPrizeForm(true))}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
            {showPrizeForm ? 'Cancel' : '+ Add prize'}
          </button>
        </div>

        {showPrizeForm && (
          <div ref={prizeFormRef} className="mb-4 grid gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 sm:grid-cols-2">
            <h3 className="sm:col-span-2 font-semibold text-gray-900">
              {editingPrizeId ? `Editing “${prizeForm.name || 'prize'}”` : 'New prize'}
            </h3>
            {editingPrizeId && (
              <p className="sm:col-span-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Stock is changed with <strong>Restock</strong>, not here. Coupons already sent to
                past winners keep the value they were issued with — this only changes what future
                winners get.
              </p>
            )}
            <label className="text-sm">
              <span className="mb-1 block font-medium text-gray-700">Prize name</span>
              <input value={prizeForm.name} onChange={(e) => setPrizeForm({ ...prizeForm, name: e.target.value })}
                placeholder="Microfibre Cloth" className="w-full rounded-lg border border-gray-300 px-3 py-2" />
            </label>
            <label className="sm:col-span-2 text-sm">
              <span className="mb-1 block font-medium text-gray-700">
                Picture on the wheel <span className="font-normal text-gray-500">(optional — a t-shirt prize shows a t-shirt)</span>
              </span>
              <div className="flex items-center gap-3">
                {prizeForm.imageUrl ? (
                  <>
                    {/* Round, because that is exactly how it is clipped on the dial —
                        a square preview would misrepresent the crop. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={prizeForm.imageUrl} alt=""
                      className="h-14 w-14 rounded-full border border-gray-300 object-cover" />
                    <button type="button"
                      onClick={() => setPrizeForm({ ...prizeForm, imageUrl: null })}
                      className="text-sm text-red-600 hover:underline">Remove</button>
                  </>
                ) : (
                  <div className="flex h-14 w-14 items-center justify-center rounded-full border border-dashed border-gray-300 text-xs text-gray-400">
                    none
                  </div>
                )}
                <input type="file" accept="image/*" disabled={uploading}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadPrizeImage(f); e.target.value = ''; }}
                  className="text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-200 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-gray-300" />
                {uploading && <span className="text-sm text-gray-500">Uploading…</span>}
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Square images work best — it is cropped to a circle on the dial. Slices with no
                picture just show their text label.
              </p>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-gray-700">Short label (fits on the dial, ≤24 chars)</span>
              <input value={prizeForm.shortLabel} maxLength={24}
                onChange={(e) => setPrizeForm({ ...prizeForm, shortLabel: e.target.value })}
                placeholder="Cloth" className="w-full rounded-lg border border-gray-300 px-3 py-2" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-gray-700">Type</span>
              {/*
                Locked on edit. Changing what kind of thing a prize is routes the next
                winner down a different award path than the one the campaign was
                published against — the backend refuses it outright on a live campaign,
                so offering it here would only produce a rejected save.
              */}
              <select value={prizeForm.kind}
                disabled={Boolean(editingPrizeId)}
                onChange={(e) => setPrizeForm({ ...prizeForm, kind: e.target.value as PrizeKind })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 disabled:bg-gray-100 disabled:text-gray-500">
                {(Object.keys(KIND_LABEL) as PrizeKind[]).map((k) => (
                  <option key={k} value={k}>{KIND_LABEL[k]}</option>
                ))}
              </select>
            </label>
            {prizeForm.kind === 'goodie' && (
              <label className="text-sm">
                <span className="mb-1 block font-medium text-gray-700">SKU (what the packer looks for)</span>
                <input value={prizeForm.sku} onChange={(e) => setPrizeForm({ ...prizeForm, sku: e.target.value })}
                  placeholder="GOODIE-MF" className="w-full rounded-lg border border-gray-300 px-3 py-2" />
              </label>
            )}
            {prizeForm.kind === 'coupon' && (
              <>
                <label className="text-sm">
                  <span className="mb-1 block font-medium text-gray-700">Discount type</span>
                  <select value={prizeForm.couponType}
                    onChange={(e) => setPrizeForm({ ...prizeForm, couponType: e.target.value as typeof prizeForm.couponType })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2">
                    <option value="fixed">₹ off</option>
                    <option value="percentage">% off</option>
                    <option value="free_shipping">Free shipping</option>
                  </select>
                </label>
                {prizeForm.couponType !== 'free_shipping' && (
                  <label className="text-sm">
                    <span className="mb-1 block font-medium text-gray-700">
                      How much off? ({prizeForm.couponType === 'percentage' ? '%' : '₹'})
                    </span>
                    <input type="number" min={1} value={prizeForm.couponValue}
                      onChange={(e) => setPrizeForm({ ...prizeForm, couponValue: Number(e.target.value) })}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2" />
                  </label>
                )}
                <label className="text-sm">
                  <span className="mb-1 block font-medium text-gray-700">Minimum next-order value (₹)</span>
                  <input type="number" min={0} value={prizeForm.couponMinCartValue}
                    onChange={(e) => setPrizeForm({ ...prizeForm, couponMinCartValue: Number(e.target.value) })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2" />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block font-medium text-gray-700">Valid for (days)</span>
                  <input type="number" min={1} max={365} value={prizeForm.couponValidDays}
                    onChange={(e) => setPrizeForm({ ...prizeForm, couponValidDays: Number(e.target.value) })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2" />
                </label>
                <p className="text-xs text-gray-500 sm:col-span-2">
                  Each winner gets their <strong>own single-use code</strong> (e.g. <code>SPIN-4F2A91C3</code>),
                  minted automatically and shown on screen plus emailed. Not one shared code —
                  a shared code that leaks online can be redeemed by anyone.
                </p>
              </>
            )}
            {!prizeForm.isFloorPrize && (
              <label className="text-sm">
                <span className="mb-1 block font-medium text-gray-700">How many do you have?</span>
                <input type="number" min={0} value={prizeForm.stockTotal ?? 0}
                  onChange={(e) => setPrizeForm({ ...prizeForm, stockTotal: Number(e.target.value) })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2" />
                <span className="mt-1 block text-xs text-gray-500">
                  This also sets the odds — rarer items are won less often, automatically.
                </span>
              </label>
            )}
            <label className="text-sm">
              <span className="mb-1 block font-medium text-gray-700">Minimum order value (₹)</span>
              <input type="number" min={0} value={prizeForm.minOrderValueRupees}
                onChange={(e) => setPrizeForm({ ...prizeForm, minOrderValueRupees: Number(e.target.value) })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2" />
              <span className="mt-1 block text-xs text-gray-500">
                Stops a small order winning an expensive item. 0 = anyone can win it.
              </span>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-gray-700">Max wins per day (optional)</span>
              <input type="number" min={1} value={prizeForm.maxWinsPerDay ?? ''}
                onChange={(e) => setPrizeForm({
                  ...prizeForm,
                  maxWinsPerDay: e.target.value === '' ? null : Number(e.target.value),
                })}
                placeholder="no limit" className="w-full rounded-lg border border-gray-300 px-3 py-2" />
              <span className="mt-1 block text-xs text-gray-500">
                Paces expensive items so they last the whole campaign instead of going on day one.
              </span>
            </label>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={prizeForm.isFloorPrize}
                disabled={Boolean(editingPrizeId)}
                onChange={(e) => setPrizeForm({ ...prizeForm, isFloorPrize: e.target.checked })} />
              <span className="font-medium text-gray-700">
                This is the guaranteed fallback (unlimited, everyone who misses a goodie gets it)
              </span>
            </label>
            <div className="sm:col-span-2 flex items-center gap-2">
              <button
                onClick={editingPrizeId ? updatePrizeFields : addPrize}
                disabled={busy || !prizeForm.name.trim()}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {busy ? 'Saving…' : editingPrizeId ? 'Save changes' : 'Add prize'}
              </button>
              {editingPrizeId && (
                <button onClick={closePrizeForm} disabled={busy}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                  Cancel
                </button>
              )}
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-3 py-2">Prize</th>
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2 text-right">Left</th>
                <th className="px-3 py-2 text-right">Given</th>
                <th className="px-3 py-2 text-right">Min order</th>
                <th className="px-3 py-2 text-right">Chance</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {goodies.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-500">
                  No goodies yet. A wheel needs at least one real prize.
                </td></tr>
              )}
              {goodies.map((p) => {
                const row = odds?.rows.find((r) => r.prizeId === p._id);
                const low = (p.stockRemaining ?? 0) <= 3;
                return (
                  <tr key={p._id} className="border-t border-gray-100">
                    <td className="px-3 py-2 font-medium text-gray-900">{p.name}</td>
                    <td className="px-3 py-2 text-gray-500">{p.sku || '—'}</td>
                    <td className={`px-3 py-2 text-right font-semibold ${low ? 'text-red-600' : 'text-gray-800'}`}>
                      {p.stockRemaining ?? '∞'}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-600">{p.stockAwarded}</td>
                    <td className="px-3 py-2 text-right text-gray-600">
                      {p.minOrderValuePaise > 0 ? `₹${(p.minOrderValuePaise / 100).toLocaleString('en-IN')}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-800">
                      {row ? `${(row.probability * 100).toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button
                        onClick={() => {
                          const v = prompt(`New TOTAL stock for ${p.name} (currently ${p.stockTotal}):`, String(p.stockTotal ?? 0));
                          if (v !== null) void restock(p, Number(v));
                        }}
                        className="mr-2 text-blue-600 hover:underline">Restock</button>
                      <button onClick={() => openEdit(p)} className="mr-2 text-blue-600 hover:underline">Edit</button>
                      <button onClick={() => removePrize(p)} className="text-red-600 hover:underline">Remove</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Odds preview ─────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-gray-900">Live odds &amp; how long stock will last</h2>
            <p className="text-xs text-gray-500">
              Computed by the server from current stock — this is exactly what the draw uses.
            </p>
          </div>
          <label className="text-sm text-gray-700">
            Paid orders per day:{' '}
            <input type="number" min={0} value={ordersPerDay}
              onChange={(e) => setOrdersPerDay(Number(e.target.value))}
              className="w-24 rounded-lg border border-gray-300 px-2 py-1" />
          </label>
        </div>

        {!odds ? (
          <p className="text-sm text-gray-500">Odds unavailable.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-3 py-2">Prize</th>
                <th className="px-3 py-2 text-right">Chance per spin</th>
                <th className="px-3 py-2 text-right">Expected wins/day</th>
                <th className="px-3 py-2 text-right">Stock lasts</th>
              </tr>
            </thead>
            <tbody>
              {odds.rows.map((r) => (
                <tr key={r.prizeId} className={`border-t border-gray-100 ${r.isFloorPrize ? 'bg-indigo-50/50' : ''}`}>
                  <td className="px-3 py-2 text-gray-900">
                    {r.name} {r.isFloorPrize && <span className="text-xs text-indigo-700">(fallback)</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-medium">{(r.probability * 100).toFixed(1)}%</td>
                  <td className="px-3 py-2 text-right text-gray-600">{r.expectedWinsPerDay.toFixed(1)}</td>
                  <td className="px-3 py-2 text-right text-gray-600">
                    {r.daysToExhaustion === null
                      ? '∞'
                      : <span className={r.daysToExhaustion < 7 ? 'font-semibold text-red-600' : ''}>
                          {r.daysToExhaustion.toFixed(0)} days
                        </span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
