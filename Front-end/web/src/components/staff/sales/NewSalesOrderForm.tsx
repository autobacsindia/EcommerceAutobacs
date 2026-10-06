'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Minus, Plus, Search, Trash2, CheckCircle2 } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { staffKeys } from '@/hooks/queries/keys';
import PaymentLinkCard from './PaymentLinkCard';
import { deepDiscountLines, deepDiscountWarning, isDeepDiscount } from './offerGuard';
import { errorMessage, rupees, type SalesOrder, type SalesProduct } from './types';

type Line = {
  key: string;
  productId: string;
  variantId: string | null;
  name: string;
  image: string;
  /** Catalogue price at the time it was picked — the server re-checks it. */
  listPrice: number;
  quantity: number;
  /** What the rep typed; empty = full price. */
  offer: string;
};

type Created = {
  order: SalesOrder;
  paymentLink: { id: string; shortUrl: string };
  customerIsNew: boolean;
};

const EMPTY_CUSTOMER = { name: '', email: '', phone: '' };
const EMPTY_ADDRESS = { addressLine1: '', addressLine2: '', city: '', state: '', postalCode: '' };

const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
const label = 'mb-1 block text-xs font-medium text-gray-700';

/** Debounce a fast-changing value (search box). */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const lineOffer = (l: Line) => {
  const n = l.offer.trim() === '' ? l.listPrice : Number(l.offer);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Sales member raises an order for a customer on the phone / WhatsApp.
 *
 * Prices shown here are a preview: the server re-prices every line from the
 * catalogue and only accepts an offer between ₹1 and that price, so nothing typed
 * here can raise or zero a price.
 */
export default function NewSalesOrderForm() {
  const queryClient = useQueryClient();
  const [customer, setCustomer] = useState(EMPTY_CUSTOMER);
  const [address, setAddress] = useState(EMPTY_ADDRESS);
  const [lines, setLines] = useState<Line[]>([]);
  const [notes, setNotes] = useState('');
  const [q, setQ] = useState('');
  const [created, setCreated] = useState<Created | null>(null);
  const [error, setError] = useState('');
  const term = useDebounced(q.trim(), 300);

  const search = useQuery({
    queryKey: staffKeys.salesProducts(term),
    queryFn: () => apiClient.get<{ products: SalesProduct[] }>(`/staff/sales/products?q=${encodeURIComponent(term)}`),
    enabled: term.length >= 2,
    staleTime: 30_000,
  });

  function addLine(p: SalesProduct, v?: SalesProduct['variants'][number]) {
    const key = `${p.id}:${v?.id || ''}`;
    setLines((prev) => {
      const existing = prev.find((l) => l.key === key);
      if (existing) return prev.map((l) => (l.key === key ? { ...l, quantity: Math.min(100, l.quantity + 1) } : l));
      return [...prev, {
        key,
        productId: p.id,
        variantId: v?.id || null,
        name: v ? `${p.name} — ${v.label}` : p.name,
        image: p.image,
        listPrice: v ? v.price : p.price,
        quantity: 1,
        offer: '',
      }];
    });
    setQ('');
  }

  const update = (key: string, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const lineProblem = (l: Line) => {
    const o = lineOffer(l);
    if (!Number.isFinite(o) || o < 1) return 'Offer must be at least ₹1';
    if (o > l.listPrice) return `Can't be more than ${rupees(l.listPrice)}`;
    return '';
  };

  const fullTotal = lines.reduce((s, l) => s + l.listPrice * l.quantity, 0);
  const total = lines.reduce((s, l) => s + (lineProblem(l) ? l.listPrice : lineOffer(l)) * l.quantity, 0);
  const saving = Math.max(0, fullTotal - total);
  const hasProblem = lines.some((l) => lineProblem(l));

  const create = useMutation({
    mutationFn: () => apiClient.post<Created>('/staff/sales/orders', {
      customer: { name: customer.name.trim(), email: customer.email.trim(), phone: customer.phone.trim() },
      shippingAddress: { ...address, fullName: customer.name.trim(), phone: customer.phone.trim() },
      items: lines.map((l) => ({
        product: l.productId,
        variantId: l.variantId,
        quantity: l.quantity,
        offerPrice: l.offer.trim() === '' ? null : Number(l.offer),
      })),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    }),
    onSuccess: (res) => {
      setCreated(res);
      queryClient.invalidateQueries({ queryKey: staffKeys.orders() });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    onError: (e) => setError(errorMessage(e, 'Could not create the order. Please try again.')),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (lines.length === 0) { setError('Add at least one product.'); return; }
    if (hasProblem) { setError('Fix the offer prices marked in red.'); return; }
    // Last stop before a real, payable order: a price under half the catalogue
    // one is far more often a dropped zero than a deal (see offerGuard).
    const suspicious = deepDiscountLines(lines.map((l) => ({ ...l, offer: lineOffer(l) })));
    if (suspicious.length > 0 && !window.confirm(deepDiscountWarning(suspicious, rupees))) return;
    create.mutate();
  }

  function startAgain() {
    setCreated(null);
    setCustomer(EMPTY_CUSTOMER);
    setAddress(EMPTY_ADDRESS);
    setLines([]);
    setNotes('');
    setError('');
  }

  if (created) {
    const o = created.order;
    return (
      <div className="space-y-5">
        <div className="flex items-start gap-3 rounded-xl border border-green-200 bg-green-50 p-4">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
          <div className="text-sm text-green-900">
            <p className="font-semibold">Order {o.orderNumber} created — {rupees(o.totalAmount)}</p>
            <p>Send the link or QR below to {o.customer.name}. You will be emailed as soon as they pay, and Accounts and Procurement are told automatically.</p>
            {created.customerIsNew && <p className="mt-1 text-green-800">A new customer account was created; they get an email to set their password.</p>}
          </div>
        </div>
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <PaymentLinkCard
            url={created.paymentLink.shortUrl}
            orderNumber={o.orderNumber}
            amount={o.totalAmount}
            customerName={o.customer.name}
            customerPhone={o.customer.phone}
            expiresAt={o.paymentLinkExpiresAt}
          />
        </section>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={startAgain} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
            New order
          </button>
          <Link href="/team/sales" className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50">
            See my orders
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {/* Customer */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-4 text-sm font-semibold text-gray-900">Customer</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className={label} htmlFor="c-name">Name</label>
            <input id="c-name" className={input} required minLength={2} maxLength={100} value={customer.name}
              onChange={(e) => setCustomer({ ...customer, name: e.target.value })} />
          </div>
          <div>
            <label className={label} htmlFor="c-phone">Mobile (WhatsApp)</label>
            <input id="c-phone" className={input} required inputMode="tel" placeholder="98XXXXXXXX" value={customer.phone}
              pattern="(\+91[\s\-]?)?[6-9]\d{9}" title="10-digit Indian mobile number"
              onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} />
          </div>
          <div>
            <label className={label} htmlFor="c-email">Email</label>
            <input id="c-email" type="email" className={input} required value={customer.email}
              onChange={(e) => setCustomer({ ...customer, email: e.target.value })} />
          </div>
        </div>
      </section>

      {/* Delivery address */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-4 text-sm font-semibold text-gray-900">Delivery address</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={label} htmlFor="a-1">House / street</label>
            <input id="a-1" className={input} required minLength={3} maxLength={200} value={address.addressLine1}
              onChange={(e) => setAddress({ ...address, addressLine1: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor="a-2">Area / landmark (optional)</label>
            <input id="a-2" className={input} maxLength={200} value={address.addressLine2}
              onChange={(e) => setAddress({ ...address, addressLine2: e.target.value })} />
          </div>
          <div>
            <label className={label} htmlFor="a-city">City</label>
            <input id="a-city" className={input} required minLength={2} value={address.city}
              onChange={(e) => setAddress({ ...address, city: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label} htmlFor="a-state">State</label>
              <input id="a-state" className={input} required minLength={2} value={address.state}
                onChange={(e) => setAddress({ ...address, state: e.target.value })} />
            </div>
            <div>
              <label className={label} htmlFor="a-pin">PIN code</label>
              <input id="a-pin" className={input} required inputMode="numeric" pattern="\d{6}" title="6-digit PIN code" value={address.postalCode}
                onChange={(e) => setAddress({ ...address, postalCode: e.target.value })} />
            </div>
          </div>
        </div>
      </section>

      {/* Products */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-4 text-sm font-semibold text-gray-900">Products</h2>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            aria-label="Search products"
            className={`${input} pl-9`}
            placeholder="Search by product name or SKU"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {term.length >= 2 && q.trim().length >= 2 && (
            <div className="absolute z-10 mt-1 max-h-96 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
              {search.isFetching && <p className="flex items-center gap-2 p-3 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Searching…</p>}
              {search.isError && <p className="p-3 text-sm text-red-600">{errorMessage(search.error, 'Search failed.')}</p>}
              {search.data && search.data.products.length === 0 && !search.isFetching && (
                <p className="p-3 text-sm text-gray-500">No products found.</p>
              )}
              {search.data?.products.map((p) => (
                <div key={p.id} className="border-b border-gray-100 p-3 last:border-0">
                  <div className="flex items-center gap-3">
                    {p.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.image} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
                    ) : <div className="h-10 w-10 shrink-0 rounded bg-gray-100" />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900">{p.name}</p>
                      <p className="text-xs text-gray-500">{p.sku}</p>
                    </div>
                    {p.variants.length === 0 && (
                      p.available ? (
                        <button type="button" onClick={() => addLine(p)} className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
                          Add · {rupees(p.price)}
                        </button>
                      ) : <span className="shrink-0 text-xs font-medium text-red-600">Out of stock</span>
                    )}
                  </div>
                  {p.variants.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2 pl-13">
                      {p.variants.map((v) => (
                        <button
                          key={v.id}
                          type="button"
                          disabled={!v.available}
                          onClick={() => addLine(p, v)}
                          className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-800 hover:border-blue-500 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {v.label} · {v.available ? rupees(v.price) : 'Out of stock'}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {lines.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
            Search above and add the products the customer wants.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-gray-100">
            {lines.map((l) => {
              const problem = lineProblem(l);
              const offer = lineOffer(l);
              const deep = !problem && isDeepDiscount(l.listPrice, offer);
              return (
                <li key={l.key} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    {l.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={l.image} alt="" className="h-12 w-12 shrink-0 rounded object-cover" />
                    ) : <div className="h-12 w-12 shrink-0 rounded bg-gray-100" />}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">{l.name}</p>
                      <p className="text-xs text-gray-500">Price {rupees(l.listPrice)}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="flex items-center rounded-lg border border-gray-300">
                      <button type="button" aria-label="Fewer" className="p-2 text-gray-600 hover:text-gray-900 disabled:opacity-30"
                        disabled={l.quantity <= 1} onClick={() => update(l.key, { quantity: l.quantity - 1 })}>
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-8 text-center text-sm font-medium" aria-label="Quantity">{l.quantity}</span>
                      <button type="button" aria-label="More" className="p-2 text-gray-600 hover:text-gray-900 disabled:opacity-30"
                        disabled={l.quantity >= 100} onClick={() => update(l.key, { quantity: l.quantity + 1 })}>
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="w-36">
                      <label className="sr-only" htmlFor={`offer-${l.key}`}>Offer price for {l.name}</label>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">₹</span>
                        <input
                          id={`offer-${l.key}`}
                          inputMode="decimal"
                          placeholder={String(l.listPrice)}
                          value={l.offer}
                          onChange={(e) => update(l.key, { offer: e.target.value.replace(/[^\d.]/g, '') })}
                          className={`${input} pl-7 ${problem ? 'border-red-400 focus:border-red-500 focus:ring-red-100' : deep ? 'border-amber-400 focus:border-amber-500 focus:ring-amber-100' : ''}`}
                        />
                      </div>
                      <p className={`mt-1 text-xs ${problem ? 'text-red-600' : deep ? 'font-medium text-amber-700' : 'text-gray-500'}`}>
                        {problem
                          || (deep ? 'Less than half price — check it' : null)
                          || (offer < l.listPrice ? `Offer · saves ${rupees((l.listPrice - offer) * l.quantity)}` : 'Offer price (optional)')}
                      </p>
                    </div>
                    <button type="button" aria-label={`Remove ${l.name}`} onClick={() => setLines(lines.filter((x) => x.key !== l.key))}
                      className="p-2 text-gray-400 hover:text-red-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <label className={label} htmlFor="notes">Note for the team (optional)</label>
        <textarea id="notes" rows={2} maxLength={1000} className={input} value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Fitting at customer's place on Saturday" />
      </section>

      {/* Total + submit */}
      <div className="sticky bottom-0 -mx-4 border-t border-gray-200 bg-white/95 px-4 py-4 backdrop-blur md:static md:mx-0 md:rounded-xl md:border md:px-5">
        {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs text-gray-500">Customer pays</p>
            <p className="text-2xl font-bold text-gray-900">{rupees(total)}</p>
            {saving > 0 && <p className="text-xs font-medium text-green-700">Offer saves {rupees(saving)} on {rupees(fullTotal)}</p>}
          </div>
          <button
            type="submit"
            disabled={create.isPending || lines.length === 0}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Create order &amp; payment link
          </button>
        </div>
      </div>
    </form>
  );
}
