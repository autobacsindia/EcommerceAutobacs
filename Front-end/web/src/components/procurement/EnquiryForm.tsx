'use client';

import { lazy, Suspense, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Calculator, Camera, Check, Loader2, Plus, Search, Trash2, UserPlus, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { createSupplier, listSuppliers, supplierKeys, type Supplier } from '@/components/payments/suppliers';
import { MessagePreview } from './MessagePreview';
import { CatalogSuggestions, useDebounced } from './CatalogSuggestions';

// Opened per item on demand: kept out of the form's first load (React.lazy — see pages/screens.tsx).
const PriceCalculator = lazy(() => import('./PriceCalculator'));
import {
  addPhotos, createEnquiry, enquiryKeys, enquiryMessage, errorMessage, MAX_PHOTOS_PER_ITEM, photoUrl, searchCatalog, updateEnquiry, UNITS, waNumber,
  type Enquiry, type EnquiryInput, type EnquiryPhoto, type Unit,
} from './enquiry';
import { parseRupees } from './pricing';

/**
 * Write (or edit) a supplier price enquiry: items, details, which suppliers.
 * The server checks everything again; the preview is the exact WhatsApp text.
 */

const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500';

/** qty may be '' while the person retypes it; it must be a whole number ≥ 1 to save. */
type ItemDraft = Omit<EnquiryInput['items'][number], 'qty'> & {
  key: string; qty: number | '';
  /** Catalogue photo (display only — the server looks up the real one). */
  image?: string;
  /** Photos already saved on this item (removed on the enquiry page). */
  saved?: EnquiryPhoto[];
  /** Photos chosen here, uploaded right after the enquiry saves. */
  files?: File[];
};
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const NO_FILES: File[] = []; // stable, so the preview effect does not re-run every render
type PickedSupplier = { id: string; name: string; phone: string };

// Keys only tell rows apart in this form. The first row's is fixed so a server
// render and the browser's first render agree; added rows count up.
let seq = 0;
const newKey = () => { seq += 1; return `new${seq}`; };
const blankItem = (over: Partial<ItemDraft> = {}, key = newKey()): ItemDraft => ({
  key, productId: null, name: '', brand: '', partNo: '', fitment: '', qty: 1, unit: 'pcs', target: '', note: '', ...over,
});
const formKeyOf = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().replace(/-/g, '') : `${Date.now()}${Math.random().toString(36).slice(2)}`);
const rupeesText = (paise: number | null) => (paise == null ? '' : paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2));
/** A Date (India day start) → 'YYYY-MM-DD' for the date box. */
const dayOf = (iso: string | null) => (iso ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(iso)) : '');


export default function EnquiryForm({ base, enquiry, prefill }: {
  /** '/team/supplier-enquiries' or '/admin/supplier-enquiries'. */
  base: string;
  enquiry?: Enquiry;
  prefill?: { name?: string; target?: string };
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [items, setItems] = useState<ItemDraft[]>(() => (enquiry
    ? enquiry.items.map((i) => ({ key: i.id, id: i.id, productId: i.productId, name: i.name, brand: i.brand, partNo: i.partNo, fitment: i.fitment, qty: i.qty, unit: i.unit, target: rupeesText(i.targetPaise), note: i.note, image: i.image, saved: i.photos ?? [] }))
    : [blankItem({ name: prefill?.name || '', target: prefill?.target && parseRupees(prefill.target) ? prefill.target : '' }, 'first')]));
  const [details, setDetails] = useState({
    neededBy: dayOf(enquiry?.neededBy ?? null), deliverTo: enquiry?.deliverTo ?? '', notes: enquiry?.notes ?? '', showTargetPrice: enquiry?.showTargetPrice ?? false,
  });
  const [suppliers, setSuppliers] = useState<PickedSupplier[]>(() => (enquiry?.suppliers ?? []).map((s) => ({ id: s.supplierId, name: s.name, phone: s.phone })));
  const [formKey] = useState(formKeyOf);
  const [calcFor, setCalcFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const setItem = (key: string, patch: Partial<ItemDraft>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const named = items.filter((i) => i.name.trim());
    if (!named.length) { setError('Add at least one item.'); return; }
    const badTarget = named.find((i) => i.target.trim() && !(parseRupees(i.target)! > 0));
    if (badTarget) { setError(`${badTarget.name}: the target price should be in rupees, e.g. 450 or 450.50.`); return; }
    const badQty = named.find((i) => !(Number.isInteger(Number(i.qty)) && Number(i.qty) >= 1));
    if (badQty) { setError(`${badQty.name}: enter the quantity (1 or more).`); return; }
    if (!suppliers.length) { setError('Pick at least one supplier.'); return; }
    const body: EnquiryInput = {
      items: named.map(({ key: _key, image: _image, saved: _saved, files: _files, ...i }) => ({ ...i, qty: Number(i.qty) })),
      supplierIds: suppliers.map((s) => s.id),
      ...details,
      ...(enquiry ? { updatedAt: enquiry.updatedAt } : { formKey }),
    };
    setBusy(true);
    try {
      let res = enquiry ? await updateEnquiry(enquiry.id, body) : await createEnquiry(body);
      // Photos go up once the enquiry exists. The server keeps items in the order
      // sent, so the nth named draft is the nth saved item. A failed upload does
      // not lose the enquiry: it is saved, and the photos can be added on its page.
      let failed = 0;
      for (const [idx, draft] of named.entries()) {
        const target = res.enquiry.items[idx];
        if (!draft.files?.length || !target) continue;
        try { res = await addPhotos(res.enquiry.id, target.id, draft.files); } catch { failed += draft.files.length; }
      }
      qc.setQueryData(enquiryKeys.detail(res.enquiry.id), res);
      await qc.invalidateQueries({ queryKey: enquiryKeys.all, refetchType: 'none' });
      router.push(`${base}/${res.enquiry.id}${failed ? '?photos=failed' : ''}`);
    } catch (err) {
      setError(errorMessage(err, 'Could not save the enquiry. Please try again.'));
      setBusy(false);
    }
  }

  const preview = enquiryMessage({
    ref: enquiry?.ref ?? 'ENQ-…', createdAt: enquiry?.createdAt ?? new Date().toISOString(),
    neededBy: details.neededBy ? `${details.neededBy}T00:00:00+05:30` : null,
    deliverTo: details.deliverTo.trim(), notes: details.notes.trim(), showTargetPrice: details.showTargetPrice,
    contactName: enquiry?.contactName ?? user?.name ?? '',
    items: items.filter((i) => i.name.trim()).map((i) => ({
      id: i.key, productId: i.productId ?? null, name: i.name.trim(), brand: i.brand.trim(), partNo: i.partNo.trim(), fitment: i.fitment.trim(),
      qty: Number(i.qty) || 1, unit: i.unit, targetPaise: parseRupees(i.target) || null, note: i.note.trim(),
      image: i.productId ? i.image : '',
      photos: [...(i.saved ?? []), ...(i.files ?? []).map((f, n) => ({ id: `new${n}`, name: f.name, contentType: f.type }))],
    })),
  }, suppliers[0]?.name);

  return (
    <form onSubmit={submit} className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]" aria-label={enquiry ? 'Edit enquiry' : 'New enquiry'}>
      <div className="space-y-6">
        <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
          <h2 className="text-base font-semibold text-gray-900">What do you need?</h2>
          {items.map((it, idx) => (
            <ItemEditor key={it.key} n={idx + 1} item={it} enquiryId={enquiry?.id} onChange={(p) => setItem(it.key, p)}
              onRemove={items.length > 1 ? () => setItems((l) => l.filter((x) => x.key !== it.key)) : undefined}
              calcOpen={calcFor === it.key} onCalc={() => setCalcFor((c) => (c === it.key ? null : it.key))}
              onUseCalc={(target) => { setItem(it.key, { target }); setCalcFor(null); }} />
          ))}
          {items.length < 30 && (
            <button type="button" onClick={() => setItems((l) => [...l, blankItem()])}
              className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              <Plus className="h-4 w-4" /> Add another item
            </button>
          )}
        </section>

        <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
          <h2 className="text-base font-semibold text-gray-900">Details</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className={label} htmlFor="enq-needed">Needed by</label>
              <input id="enq-needed" type="date" className={input} value={details.neededBy} onChange={(e) => setDetails((d) => ({ ...d, neededBy: e.target.value }))} /></div>
            <div><label className={label} htmlFor="enq-deliver">Deliver to</label>
              <input id="enq-deliver" className={input} maxLength={200} value={details.deliverTo} placeholder="e.g. Kochi, Kerala" onChange={(e) => setDetails((d) => ({ ...d, deliverTo: e.target.value }))} /></div>
          </div>
          <div><label className={label} htmlFor="enq-notes">Remarks</label>
            <textarea id="enq-notes" rows={2} className={input} maxLength={1000} value={details.notes} placeholder="e.g. Please quote GST separately and mention the warranty."
              onChange={(e) => setDetails((d) => ({ ...d, notes: e.target.value }))} /></div>
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-gray-300" checked={details.showTargetPrice} onChange={(e) => setDetails((d) => ({ ...d, showTargetPrice: e.target.checked }))} />
            <span>Show our target price to suppliers <span className="block text-xs text-gray-500">Off by default — a supplier who sees our target usually quotes exactly that.</span></span>
          </label>
        </section>

        <SupplierChooser picked={suppliers} onChange={setSuppliers} />

        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} {enquiry ? 'Save changes' : 'Save and send'}
          </button>
          <button type="button" onClick={() => router.push(enquiry ? `${base}/${enquiry.id}` : base)} className="rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-100">Cancel</button>
        </div>
      </div>

      <aside className="xl:sticky xl:top-4 xl:self-start">
        <h2 className="mb-2 text-sm font-semibold text-gray-900">WhatsApp message preview</h2>
        <MessagePreview text={preview} />
        <p className="mt-2 text-xs text-gray-500">The reference number is given when you save. Each supplier gets their own name in “Dear …”.</p>
      </aside>
    </form>
  );
}

/** Up to MAX_PHOTOS_PER_ITEM photos per item: the catalogue photo is shown, chosen photos upload on save. */
function PhotoPicker({ inputId, n, item, enquiryId, onChange }: { inputId: string; n: number; item: ItemDraft; enquiryId?: string; onChange: (files: File[]) => void }) {
  const files = item.files ?? NO_FILES;
  const room = MAX_PHOTOS_PER_ITEM - (item.saved?.length ?? 0) - files.length;
  const [problem, setProblem] = useState('');
  const [previews, setPreviews] = useState<string[]>([]);
  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);
  const add = (list: FileList | null) => {
    setProblem('');
    const picked = Array.from(list ?? []);
    const images = picked.filter((f) => f.type.startsWith('image/') && f.size <= MAX_PHOTO_BYTES);
    if (images.length < picked.length) setProblem('Only photos up to 10 MB can be added.');
    if (images.length > room) setProblem(`An item can have ${MAX_PHOTOS_PER_ITEM} photos — ${room > 0 ? `${room} more fit` : 'no more fit'}.`);
    if (images.length) onChange([...files, ...images.slice(0, Math.max(0, room))]);
  };
  const thumb = 'relative h-16 w-16 overflow-hidden rounded-lg border border-gray-200 bg-gray-50';
  return (
    <div>
      <span className={label}>Photos</span>
      <div className="flex flex-wrap items-center gap-2">
        {item.productId && item.image && (
          // eslint-disable-next-line @next/next/no-img-element -- catalogue thumbnail, any host
          <div className={thumb} title="From our catalogue — sent as a link"><img src={item.image} alt="Catalogue photo" className="h-full w-full object-cover" /></div>
        )}
        {(item.saved ?? []).map((p) => (
          <div key={p.id} className={thumb} title={`${p.name} — saved (remove it on the enquiry page)`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- private photo, streamed by our API */}
            {enquiryId && <img src={photoUrl(enquiryId, p.id)} alt={p.name || 'Saved photo'} className="h-full w-full object-cover" />}
          </div>
        ))}
        {files.map((f, i) => (
          <div key={`${f.name}-${i}`} className={thumb}>
            {/* eslint-disable-next-line @next/next/no-img-element -- local preview (blob: URL) */}
            {previews[i] && <img src={previews[i]} alt={f.name} className="h-full w-full object-cover" />}
            <button type="button" aria-label={`Remove photo ${i + 1} of item ${n}`} onClick={() => onChange(files.filter((_, j) => j !== i))}
              className="absolute right-0.5 top-0.5 rounded-full bg-white/90 p-0.5 text-gray-700 shadow hover:text-red-600"><X className="h-3 w-3" /></button>
          </div>
        ))}
        {room > 0 && (
          <label htmlFor={inputId} className="inline-flex h-16 cursor-pointer items-center gap-1 rounded-lg border border-dashed border-gray-300 px-3 text-sm text-gray-600 hover:bg-gray-50">
            <Camera className="h-4 w-4" /> Add photo
            <input id={inputId} type="file" accept="image/*" multiple className="sr-only" aria-label={`Add photos to item ${n}`}
              onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
          </label>
        )}
      </div>
      {problem ? <p className="mt-1 text-xs text-red-600">{problem}</p>
        : <p className="mt-1 text-xs text-gray-500">Up to {MAX_PHOTOS_PER_ITEM}. WhatsApp links carry text only — photos go with the Share button, or download them to attach.</p>}
    </div>
  );
}

function ItemEditor({ n, item, enquiryId, onChange, onRemove, calcOpen, onCalc, onUseCalc }: {
  n: number; item: ItemDraft; enquiryId?: string; onChange: (p: Partial<ItemDraft>) => void; onRemove?: () => void;
  calcOpen: boolean; onCalc: () => void; onUseCalc: (target: string) => void;
}) {
  const id = (f: string) => `enq-${item.key}-${f}`;
  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-800">Item {n}</span>
        {onRemove && (
          <button type="button" onClick={onRemove} aria-label={`Remove item ${n}`} className="rounded p-1 text-gray-500 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
        )}
      </div>
      <div className="space-y-3">
        <div>
          <label className={label} htmlFor={id('name')}>Product</label>
          <input id={id('name')} className={input} maxLength={200} value={item.name} autoComplete="off"
            placeholder="Search our catalogue, or type any item" onChange={(e) => onChange({ name: e.target.value, productId: null, image: '' })} />
          {!item.productId && <CatalogSuggestions query={item.name} onPick={(p) => onChange({ name: p.name, productId: p.id, partNo: item.partNo || p.sku, image: p.image })} />}
          {item.productId && <p className="mt-1 inline-flex items-center gap-1 text-xs text-green-700"><Check className="h-3.5 w-3.5" /> From our catalogue</p>}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div><label className={label} htmlFor={id('brand')}>Brand</label>
            <input id={id('brand')} className={input} maxLength={80} value={item.brand} onChange={(e) => onChange({ brand: e.target.value })} /></div>
          <div><label className={label} htmlFor={id('part')}>Part no.</label>
            <input id={id('part')} className={input} maxLength={80} value={item.partNo} onChange={(e) => onChange({ partNo: e.target.value })} /></div>
          <div><label className={label} htmlFor={id('fit')}>Fits (vehicle)</label>
            <input id={id('fit')} className={input} maxLength={160} value={item.fitment} placeholder="e.g. Creta 2020+" onChange={(e) => onChange({ fitment: e.target.value })} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div><label className={label} htmlFor={id('qty')}>Quantity</label>
            <input id={id('qty')} className={input} type="number" min={1} max={100000} step={1} value={item.qty}
              onChange={(e) => onChange({ qty: e.target.value === '' ? '' : Math.max(0, Math.floor(Number(e.target.value) || 0)) })} /></div>
          <div><label className={label} htmlFor={id('unit')}>Unit</label>
            <select id={id('unit')} className={input} value={item.unit} onChange={(e) => onChange({ unit: e.target.value as Unit })}>
              {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select></div>
          <div className="col-span-2"><label className={label} htmlFor={id('target')}>Target / last price (per unit, before GST)</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">₹</span>
                <input id={id('target')} className={`${input} pl-7`} inputMode="decimal" value={item.target} placeholder="Optional" onChange={(e) => onChange({ target: e.target.value })} />
              </div>
              <button type="button" onClick={onCalc} aria-expanded={calcOpen}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-gray-300 px-2.5 text-sm text-gray-700 hover:bg-gray-50">
                <Calculator className="h-4 w-4" /> <span className="hidden sm:inline">Calculator</span>
              </button>
            </div></div>
        </div>
        <div><label className={label} htmlFor={id('note')}>Specs / details</label>
          <input id={id('note')} className={input} maxLength={300} value={item.note} placeholder="e.g. black finish, 12V, with wiring harness" onChange={(e) => onChange({ note: e.target.value })} /></div>
        <PhotoPicker inputId={id('photos')} n={n} item={item} enquiryId={enquiryId} onChange={(files) => onChange({ files })} />
        {calcOpen && (
          <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-900">Price calculator</span>
              <button type="button" onClick={onCalc} aria-label="Close calculator" className="rounded p-1 text-gray-500 hover:bg-gray-100"><X className="h-4 w-4" /></button>
            </div>
            <Suspense fallback={<div className="h-40 animate-pulse rounded-lg bg-white/70" aria-busy="true" />}>
              <PriceCalculator onUse={onUseCalc} initialCost={item.target} />
            </Suspense>
          </div>
        )}
      </div>
    </div>
  );
}

/** Pick several saved suppliers, or add one with just a name and WhatsApp number. */
function SupplierChooser({ picked, onChange }: { picked: PickedSupplier[]; onChange: (s: PickedSupplier[]) => void }) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const term = useDebounced(q.trim(), 250);
  const params: Record<string, string> = term ? { q: term, status: 'active' } : { status: 'active', sort: 'name' };
  const res = useQuery({ queryKey: supplierKeys.list(params), queryFn: () => listSuppliers(params), staleTime: 30_000 });
  const rows = res.data?.suppliers ?? [];
  const isPicked = (id: string) => picked.some((p) => p.id === id);
  const toggle = (s: Supplier | PickedSupplier) => onChange(isPicked(s.id) ? picked.filter((p) => p.id !== s.id) : [...picked, { id: s.id, name: s.name, phone: s.phone }]);

  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-gray-900">Send to which suppliers?</h2>
        <button type="button" onClick={() => setAdding((a) => !a)} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
          <UserPlus className="h-4 w-4" /> New supplier
        </button>
      </div>
      {adding && (
        <QuickSupplier onDone={(s) => {
          setAdding(false);
          qc.invalidateQueries({ queryKey: supplierKeys.all });
          if (!isPicked(s.id)) onChange([...picked, { id: s.id, name: s.name, phone: s.phone }]);
        }} onCancel={() => setAdding(false)} />
      )}
      {picked.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Picked suppliers">
          {picked.map((s) => (
            <li key={s.id} className="inline-flex items-center gap-1 rounded-full bg-blue-50 py-1 pl-3 pr-1 text-sm text-blue-800">
              {s.name}{!waNumber(s.phone) && <span className="text-xs text-amber-700"> · no WhatsApp no.</span>}
              <button type="button" aria-label={`Remove ${s.name}`} onClick={() => toggle(s)} className="rounded-full p-0.5 hover:bg-blue-100"><X className="h-3.5 w-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input aria-label="Search suppliers" className={`${input} pl-9`} value={q} placeholder="Search saved suppliers" onChange={(e) => setQ(e.target.value)} />
      </div>
      {res.isLoading ? (
        <p className="text-sm text-gray-500">Loading suppliers…</p>
      ) : res.isError ? (
        <p role="alert" className="text-sm text-red-700">Could not load suppliers. <button type="button" className="underline" onClick={() => res.refetch()}>Try again</button></p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500">{term ? 'No saved supplier matches.' : 'No suppliers saved yet.'} Use “New supplier” to add one.</p>
      ) : (
        <ul className="max-h-72 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200">
          {rows.map((s) => (
            <li key={s.id}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-gray-50">
                <input type="checkbox" className="h-4 w-4 rounded border-gray-300" checked={isPicked(s.id)} onChange={() => toggle(s)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-gray-900">{s.name}</span>
                  <span className="block truncate text-xs text-gray-500">{s.phone || 'No phone saved'}{s.contactPerson ? ` · ${s.contactPerson}` : ''}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function QuickSupplier({ onDone, onCancel }: { onDone: (s: Supplier) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    setError('');
    if (name.trim().length < 2) { setError('Enter the supplier’s name.'); return; }
    if (!waNumber(phone)) { setError('Enter their WhatsApp number (10 digits, or with the country code).'); return; }
    setBusy(true);
    try {
      const res = await createSupplier({
        name: name.trim(), contactPerson: '', phone: phone.trim(), email: '', gstin: '', address: '', notes: '',
        payment: { method: 'none', upiId: '', accountName: '', accountNumber: '', ifsc: '', swift: '', bankName: '' },
      });
      onDone(res.supplier);
    } catch (err) {
      setError(errorMessage(err, 'Could not save the supplier. Please try again.'));
      setBusy(false);
    }
  }
  // Not a <form>: it sits inside the enquiry form, and nested forms are invalid HTML.
  return (
    <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <input aria-label="New supplier name" className={input} maxLength={120} value={name} placeholder="Supplier name" onChange={(e) => setName(e.target.value)} />
        <input aria-label="New supplier WhatsApp number" className={input} inputMode="tel" maxLength={20} value={phone} placeholder="WhatsApp number" onChange={(e) => setPhone(e.target.value)} />
      </div>
      <p className="text-xs text-gray-500">Bank or UPI details can be added later in Suppliers, before you pay them.</p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save supplier
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100">Cancel</button>
      </div>
    </div>
  );
}
