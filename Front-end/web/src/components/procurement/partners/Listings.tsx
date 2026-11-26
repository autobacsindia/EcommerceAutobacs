'use client';

import { useMemo, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Link2, PackagePlus } from 'lucide-react';
import { useCategories } from '@/hooks/queries/useCategories';
import { enquiryKeys, searchCatalog } from '../enquiry';
import {
  AVAILABILITY_LABEL, LISTING_STATUS_LABEL, approveLink, approveNew, errorCode, errorMessage, getListing, getMarginRules,
  listListings, listingAction, listingImageUrl, paiseToRupees, partnerKeys, ruleFor, rupees,
  type ListingDetail, type ListingStatus, type ProductCard, type ProductForm,
} from './api';
import PriceBox, { priceSendable, priceState, type PriceBoxValue } from './PriceBox';
import { Empty, Loading, LoadError, MoreButton, NoteAction, Pills, btn, when } from './ui';

const TABS = [['submitted', 'Waiting'], ['changes_requested', 'Asked to fix'], ['live', 'Live'], ['rejected', 'Rejected'], ['withdrawn', 'Withdrawn']] as const;

/** Products suppliers listed in the app: the queue, then the review screen. */
export default function Listings({ openId, onOpen }: { openId: string; onOpen: (id: string) => void }) {
  if (openId) return <ListingReview id={openId} onBack={() => onOpen('')} />;
  return <ListingQueue onOpen={onOpen} />;
}

function ListingQueue({ onOpen }: { onOpen: (id: string) => void }) {
  const [status, setStatus] = useState<ListingStatus>('submitted');
  const q = useInfiniteQuery({
    queryKey: partnerKeys.listings(status),
    queryFn: ({ pageParam }) => listListings(status, pageParam),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor || undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="space-y-3">
      <Pills label="Which products" value={status} options={TABS} onChange={setStatus} />
      {q.isPending && <Loading />}
      {q.isError && <LoadError error={q.error} retry={() => q.refetch()} what="products" />}
      {q.isSuccess && rows.length === 0 && <Empty>No products here.</Empty>}
      <ul className="space-y-2">
        {rows.map((l) => (
          <li key={l.id}>
            <button type="button" onClick={() => onOpen(l.id)} className="block w-full rounded-xl border border-gray-200 bg-white p-4 text-left hover:border-blue-300 hover:bg-blue-50/30">
              <span className="font-semibold text-gray-900">{l.title}</span>
              <span className="block text-sm text-gray-600">{l.companyName} · {[l.brand, l.partNumber].filter(Boolean).join(' · ')}</span>
              <span className="block text-xs text-gray-500">
                Supplier&apos;s price {paiseToRupees(l.costPaise)} + {l.gstPct}% GST · {AVAILABILITY_LABEL[l.availability]} · sent {when(l.submittedAt)}
              </span>
              {l.editedSinceLive && <span className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">Supplier changed it after it went live</span>}
            </button>
          </li>
        ))}
      </ul>
      <MoreButton hasMore={!!q.hasNextPage} loading={q.isFetchingNextPage} onMore={() => q.fetchNextPage()} />
    </div>
  );
}

function ListingReview({ id, onBack }: { id: string; onBack: () => void }) {
  const q = useQuery({ queryKey: partnerKeys.listing(id), queryFn: () => getListing(id) });
  if (q.isPending) return <Loading />;
  if (q.isError) return <LoadError error={q.error} retry={() => q.refetch()} what="the product" />;
  // Keyed on rev: a reload after the supplier edited starts the form from their new words.
  return <ReviewBody key={`${q.data.id}:${q.data.rev}`} listing={q.data} onBack={onBack} />;
}

function SupplierSide({ l }: { l: ListingDetail }) {
  return (
    <section aria-label="What the supplier sent" className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">What the supplier sent</h3>
      <p className="text-base font-semibold text-gray-900">{l.title}</p>
      <p className="text-sm text-gray-600">{l.supplier?.companyName}{l.supplier?.city ? `, ${l.supplier.city}` : ''}</p>
      {l.images.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {l.images.map((img) => (
            <a key={img.index} href={listingImageUrl(l.id, img.index)} target="_blank" rel="noopener noreferrer">
              {/* Private photo through our API (signed-in staff only) — next/image cannot fetch it. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={listingImageUrl(l.id, img.index)} alt={`Supplier photo ${img.index + 1}`} className="aspect-square w-full rounded-lg border border-gray-200 bg-white object-cover" />
            </a>
          ))}
        </div>
      )}
      <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-gray-500">Brand</dt><dd>{l.brand || '—'}</dd>
        <dt className="text-gray-500">Part number</dt><dd>{l.partNumber || '—'}</dd>
        <dt className="text-gray-500">Fits</dt><dd>{l.fits || '—'}</dd>
        <dt className="text-gray-500">Their category</dt><dd>{l.categoryHint || '—'}</dd>
        <dt className="text-gray-500">Stock</dt><dd>{AVAILABILITY_LABEL[l.availability]} · ships in {l.dispatchDays} day{l.dispatchDays === 1 ? '' : 's'}</dd>
      </dl>
      {l.description && <p className="whitespace-pre-line text-sm text-gray-800">{l.description}</p>}
      {l.specs.length > 0 && (
        <ul className="text-sm text-gray-800">{l.specs.map((s) => <li key={s.label}><span className="text-gray-500">{s.label}:</span> {s.value}</li>)}</ul>
      )}
    </section>
  );
}

function ReviewBody({ listing: l, onBack }: { listing: ListingDetail; onBack: () => void }) {
  const qc = useQueryClient();
  const rules = useQuery({ queryKey: partnerKeys.marginRules(), queryFn: getMarginRules });
  const categories = useCategories();
  const waiting = l.status === 'submitted';
  const [mode, setMode] = useState<'new' | 'link'>(l.duplicates.length ? 'link' : 'new');
  const [form, setForm] = useState<ProductForm>({
    name: l.title, description: l.description, shortDescription: '', categories: [], brand: l.brand, sku: l.partNumber,
    specifications: l.specs.map((s) => ({ key: s.label, value: s.value })),
  });
  const [images, setImages] = useState<number[]>(l.images.map((i) => i.index));
  const [keepHidden, setKeepHidden] = useState(false);
  const [drivesStock, setDrivesStock] = useState(true);
  const [linkTo, setLinkTo] = useState<ProductCard | null>(l.duplicates[0] ?? null);
  const [setPrice, setSetPrice] = useState(false);
  const [price, setPriceBox] = useState<PriceBoxValue>({ price: '', override: false, reason: '' });
  const [done, setDone] = useState('');

  const ruleCats = mode === 'new' ? form.categories : [];
  const rule = ruleFor(rules.data, ruleCats) ?? l.pricing.rule;
  // Linking without a new price: the product's current price must still clear the rules.
  const effective: PriceBoxValue = mode === 'link' && !setPrice ? { ...price, price: String(linkTo?.price ?? '') } : price;
  const ps = priceState(l.costPaise, l.gstPct, rule, effective.price);
  const formOk = mode === 'link'
    ? !!linkTo
    : form.name.trim().length >= 3 && form.description.trim().length >= 10 && form.categories.length > 0;
  const canApprove = waiting && formOk && priceSendable(ps, effective);

  const approve = useMutation({
    mutationFn: () => {
      const override = ps.belowFloor ? { override: effective.override, overrideReason: effective.reason } : {};
      return mode === 'new'
        ? approveNew(l.id, { rev: l.rev, product: form, price: ps.price!, keepHidden, imageIndexes: images, drivesStock, ...override })
        : approveLink(l.id, { rev: l.rev, productId: linkTo!.id, setPrice, ...(setPrice ? { price: ps.price! } : {}), ...override });
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: partnerKeys.all });
      setDone(mode === 'new'
        ? `Approved. "${r.product?.name}" is ${keepHidden ? 'saved but hidden from customers' : 'live on the website'} at ${rupees(r.product?.price ?? 0)}.`
        : `Approved and linked to "${r.product?.name}".`);
    },
  });
  const act = useMutation({
    mutationFn: ({ action, note }: { action: 'request-changes' | 'reject'; note: string }) => listingAction(l.id, action, note),
    onSuccess: () => { qc.invalidateQueries({ queryKey: partnerKeys.all }); onBack(); },
  });
  const stale = errorCode(approve.error) === 'LISTING_CHANGED';

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm text-blue-700 hover:underline"><ArrowLeft className="h-4 w-4" /> All products</button>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-gray-900">{l.title}</h2>
        <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">{LISTING_STATUS_LABEL[l.status]}</span>
      </div>
      {l.reviewNote && <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">Note: {l.reviewNote}</p>}
      {l.product && <p className="text-sm text-gray-700">Live as <a className="text-blue-700 underline" href={`/products/${l.product.slug}`} target="_blank" rel="noopener noreferrer">{l.product.name}</a> at {rupees(l.product.price)}.</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <SupplierSide l={l} />
        <div className="space-y-4">
          {done ? (
            <p role="status" className="flex items-start gap-2 rounded-xl bg-green-50 p-4 text-sm text-green-800"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {done}</p>
          ) : waiting ? (
            <>
              <div className="flex flex-col gap-2 text-sm sm:flex-row sm:gap-4">
                <label className="flex items-center gap-2"><input type="radio" name="approve-as" checked={mode === 'link'} onChange={() => setMode('link')} /> <Link2 className="h-4 w-4" /> We already sell this — link</label>
                <label className="flex items-center gap-2"><input type="radio" name="approve-as" checked={mode === 'new'} onChange={() => setMode('new')} /> <PackagePlus className="h-4 w-4" /> New product</label>
              </div>
              {mode === 'link'
                ? <LinkPicker listing={l} value={linkTo} onChange={setLinkTo} />
                : <ProductFormBox form={form} onChange={setForm} categories={categories.data ?? []} listing={l} images={images} onImages={setImages} />}

              {mode === 'link' && (
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={setPrice} onChange={(e) => setSetPrice(e.target.checked)} /> Also change the price on the website</label>
              )}
              {(mode === 'new' || setPrice) ? (
                <PriceBox costPaise={l.costPaise} gstPct={l.gstPct} rule={rule} value={price} onChange={setPriceBox} currentPrice={mode === 'link' ? linkTo?.price ?? null : null} />
              ) : linkTo && (
                <PriceBox costPaise={l.costPaise} gstPct={l.gstPct} rule={rule} value={effective}
                  onChange={(v) => setPriceBox({ ...price, override: v.override, reason: v.reason })} label="Price on the website (unchanged)" />
              )}

              {mode === 'new' && (
                <div className="space-y-1 text-sm">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={keepHidden} onChange={(e) => setKeepHidden(e.target.checked)} /> Approve but keep hidden from customers (e.g. to add more photos first)</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={drivesStock} onChange={(e) => setDrivesStock(e.target.checked)} /> This supplier sets the stock (their &quot;out of stock&quot; shows on the website)</label>
                </div>
              )}

              {approve.isError && (
                <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                  {errorMessage(approve.error, 'Could not approve.')}
                  {stale && <> <button type="button" className="underline" onClick={() => qc.invalidateQueries({ queryKey: partnerKeys.listing(l.id) })}>Load their latest version</button></>}
                </p>
              )}
              <button type="button" className={`${btn.primary} w-full sm:w-auto`} disabled={!canApprove || approve.isPending} onClick={() => approve.mutate()}>
                {approve.isPending ? 'Approving…' : mode === 'new' ? 'Approve as new product' : 'Approve and link'}
              </button>
              {act.isError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorMessage(act.error, 'Could not save.')}</p>}
              <div className="flex flex-wrap gap-2">
                <NoteAction label="Ask to fix" title="What should they fix?" hint="The supplier sees this in the app, edits and sends again."
                  placeholder="e.g. Add a photo of the box with the part number." busy={act.isPending} onSubmit={(note) => act.mutate({ action: 'request-changes', note })} />
                <NoteAction danger label="Reject" title="Why are we not listing this?" hint="Final for this listing."
                  placeholder="e.g. We do not sell this kind of product." busy={act.isPending} onSubmit={(note) => act.mutate({ action: 'reject', note })} />
              </div>
            </>
          ) : (
            <PriceBox costPaise={l.costPaise} gstPct={l.gstPct} rule={l.pricing.rule}
              value={{ price: String(l.product?.price ?? ''), override: false, reason: '' }} onChange={() => {}} label="Price on the website" />
          )}
        </div>
      </div>
    </div>
  );
}

function LinkPicker({ listing, value, onChange }: { listing: ListingDetail; value: ProductCard | null; onChange: (p: ProductCard | null) => void }) {
  const [search, setSearch] = useState('');
  const found = useQuery({
    queryKey: enquiryKeys.products(search),
    queryFn: () => searchCatalog(search),
    enabled: search.trim().length >= 2,
  });
  const options: ProductCard[] = useMemo(() => (search.trim().length >= 2
    ? (found.data?.products ?? []).map((p) => ({ id: p.id, name: p.name, slug: '', sku: p.sku, price: p.price, stock: '', isActive: true, productType: 'simple', image: p.image }))
    : listing.duplicates), [search, found.data, listing.duplicates]);
  return (
    <section aria-label="Pick the product" className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-sm font-semibold text-gray-900">Which product on our website is it?</p>
      {listing.duplicates.length > 0 && !search && <p className="text-xs text-gray-500">These look like the same item (same part number or a similar name):</p>}
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search our products, e.g. Bosch wiper 24" aria-label="Search products"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      {options.length === 0 && <p className="text-xs text-gray-500">{search.trim().length >= 2 ? 'Nothing found.' : 'No likely matches — search, or approve as a new product.'}</p>}
      <ul className="space-y-1">
        {options.map((p) => (
          <li key={p.id}>
            <label className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-sm ${value?.id === p.id ? 'border-blue-400 bg-blue-50/40' : 'border-gray-200'}`}>
              <input type="radio" name="link-product" checked={value?.id === p.id} onChange={() => onChange(p)} />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {p.image ? <img src={p.image} alt="" className="h-10 w-10 rounded object-cover" /> : <span className="h-10 w-10 rounded bg-gray-100" />}
              <span className="min-w-0"><span className="block truncate font-medium">{p.name}</span><span className="text-xs text-gray-500">{[p.sku, rupees(p.price), p.isActive ? '' : 'hidden'].filter(Boolean).join(' · ')}</span></span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProductFormBox({ form, onChange, categories, listing, images, onImages }: {
  form: ProductForm; onChange: (f: ProductForm) => void; categories: { _id: string; name: string }[];
  listing: ListingDetail; images: number[]; onImages: (i: number[]) => void;
}) {
  const set = (patch: Partial<ProductForm>) => onChange({ ...form, ...patch });
  const input = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm';
  return (
    <section aria-label="Product on our website" className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-sm font-semibold text-gray-900">How it will show on our website</p>
      <label className="block text-sm"><span className="font-medium">Product name</span>
        <input value={form.name} onChange={(e) => set({ name: e.target.value })} maxLength={200} className={input} placeholder="e.g. Bosch Aerotwin Wiper Blade 24 inch" />
      </label>
      <label className="block text-sm"><span className="font-medium">Category</span>
        <select aria-label="Category" value={form.categories[0] ?? ''} onChange={(e) => set({ categories: e.target.value ? [e.target.value] : [] })} className={input}>
          <option value="">Pick a category…</option>
          {categories.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
        </select>
        {listing.categoryHint && <span className="text-xs text-gray-500">The supplier said: {listing.categoryHint}</span>}
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm"><span className="font-medium">Brand</span>
          <input value={form.brand} onChange={(e) => set({ brand: e.target.value })} maxLength={80} className={input} />
        </label>
        <label className="block text-sm"><span className="font-medium">SKU / part number</span>
          <input value={form.sku} onChange={(e) => set({ sku: e.target.value })} maxLength={80} className={input} />
        </label>
      </div>
      <label className="block text-sm"><span className="font-medium">Description</span>
        <textarea value={form.description} onChange={(e) => set({ description: e.target.value })} rows={5} className={input} />
      </label>
      <label className="block text-sm"><span className="font-medium">Short line under the name (optional)</span>
        <input value={form.shortDescription} onChange={(e) => set({ shortDescription: e.target.value })} maxLength={200} className={input} placeholder="e.g. Streak-free, fits J-hook arms" />
      </label>
      {listing.images.length > 0 && (
        <fieldset className="text-sm">
          <legend className="font-medium">Photos to use (copied to the website; the first ticked is the main photo)</legend>
          <div className="mt-1 flex flex-wrap gap-3">
            {listing.images.map((img) => (
              <label key={img.index} className="flex items-center gap-1">
                <input type="checkbox" checked={images.includes(img.index)}
                  onChange={(e) => onImages(e.target.checked ? [...images, img.index].sort((a, b) => a - b) : images.filter((i) => i !== img.index))} />
                Photo {img.index + 1}
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </section>
  );
}
