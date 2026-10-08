'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { CarFront, Check, ChevronDown, Search, ShieldCheck, Wrench } from 'lucide-react';
import { useVehicleMakes, useVehicleModels } from '@/hooks/queries/useVehicleMakes';
import { useCategories } from '@/hooks/queries/useCategories';
import { capture } from '@/lib/analytics';
import apiClient from '@/lib/api';
import { productKeys } from '@/hooks/queries/keys';

/**
 * "Find parts for your car" — make → model → main category → Search.
 *
 * With a category it lands on the category page with the vehicle filter applied
 * (/categories/<slug>?vehicleMake=Toyota&vehicleModel=Hilux); without one it
 * shows every part for the vehicle (/products?vehicleMake=…&vehicleModel=…).
 * Both pages already honour these params, so there is no new search path.
 *
 * Search stays visible but dimmed until a model (or a category) is chosen.
 *
 * Once a vehicle is chosen the chips show how many parts fit it and hide the
 * categories with none — not every category stocks parts for every car, and a
 * chip that leads to an empty page is a dead end. If the counts can't be loaded
 * the chips simply show without them.
 *
 * Built with Tailwind, so the root opts out of the home page's CSS reset
 * (`hr-unscoped`, see home-redesign.css) — otherwise the reset strips every
 * padding and margin utility.
 */

const selectClass =
  'w-full appearance-none rounded-xl border border-white/15 bg-black/45 px-4 py-4 pr-11 text-[15px] text-[#f0ede7] transition-colors hover:border-[#c9a870]/60 focus:border-[#c9a870] focus:outline-none focus:ring-2 focus:ring-[#c9a870]/25 disabled:cursor-not-allowed disabled:opacity-45';

/** Shortcut chips under the make picker — shown only if the catalogue has them. */
const POPULAR_MAKES = ['Toyota', 'Mahindra', 'Tata', 'Maruti Suzuki', 'Hyundai', 'Kia', 'Land Rover'];

export default function VehicleFinder() {
  const router = useRouter();
  const { data: makes = [] } = useVehicleMakes();
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [categorySlug, setCategorySlug] = useState('');
  const { data: models = [], isFetching: loadingModels } = useVehicleModels(make);
  const { data: categories } = useCategories();

  // Main categories only (no parent) that have a page to land on.
  const allHubs = useMemo(
    () => (categories ?? []).filter((c) => !c.parent && c.slug).sort((a, b) => a.name.localeCompare(b.name)),
    [categories],
  );

  const vehicleChosen = !!(make && model);

  // Parts per main category for the chosen vehicle (subtree-rolled counts from
  // the same facets endpoint the shop sidebar uses).
  const { data: fitCounts } = useQuery({
    queryKey: productKeys.facets({ vehicleMake: make, vehicleModel: model }),
    queryFn: async () => {
      const qs = new URLSearchParams({ vehicleMake: make, vehicleModel: model }).toString();
      const res = await apiClient.get<{ facets?: { categories?: { categoryId: string; count: number }[] } }>(
        `/products/facets?${qs}`,
      );
      return new Map((res?.facets?.categories ?? []).map((c) => [String(c.categoryId), c.count]));
    },
    enabled: vehicleChosen,
    staleTime: 5 * 60 * 1000,
  });

  // With a vehicle and its counts: only categories that have parts for it.
  const hubs = useMemo(
    () => (vehicleChosen && fitCounts ? allHubs.filter((h) => (fitCounts.get(String(h._id)) ?? 0) > 0) : allHubs),
    [allHubs, vehicleChosen, fitCounts],
  );
  const countFor = (id: string) => (vehicleChosen && fitCounts ? fitCounts.get(String(id)) : undefined);

  // A category picked before the vehicle may not fit it — drop it rather than
  // send the visitor to an empty page.
  const activeSlug = hubs.some((h) => h.slug === categorySlug) ? categorySlug : '';
  const activeName = hubs.find((h) => h.slug === activeSlug)?.name ?? '';

  const ready = vehicleChosen || !!activeSlug;

  const search = () => {
    if (!ready) return;
    const params = new URLSearchParams();
    if (make) params.set('vehicleMake', make);
    if (make && model) params.set('vehicleModel', model);
    capture('vehicle_finder_search', { make, model, category: activeSlug || 'all' });
    const qs = params.toString();
    const path = activeSlug ? `/categories/${encodeURIComponent(activeSlug)}` : '/products';
    router.push(`${path}${qs ? `?${qs}` : ''}`);
  };

  // Which step the visitor is on — drives the guide at the top.
  const stepState = (n: 1 | 2 | 3) => {
    const done = n === 1 ? !!make : n === 2 ? vehicleChosen : !!activeSlug;
    const current = n === 1 ? !make : n === 2 ? !!make && !model : vehicleChosen && !activeSlug;
    return done ? 'done' : current ? 'current' : 'todo';
  };
  // One-tap shortcuts for the makes most customers drive — only those we stock.
  const popularMakes = POPULAR_MAKES.filter((name) => makes.some((m) => m.name === name));

  return (
    <section className="hr-unscoped relative z-10 px-4 py-14 sm:px-6 md:py-20" aria-labelledby="vehicle-finder-title">
      <div className="relative mx-auto max-w-5xl overflow-hidden rounded-3xl border border-[#c9a870]/35 bg-[radial-gradient(ellipse_80%_60%_at_50%_0%,rgba(201,168,112,0.14)_0%,transparent_60%),linear-gradient(160deg,#1b1c1c_0%,#101111_55%,#17130c_100%)] shadow-[0_40px_90px_-30px_rgba(0,0,0,0.95),0_0_70px_-25px_rgba(201,168,112,0.35)]">
        <div aria-hidden="true" className="h-[3px] bg-gradient-to-r from-transparent via-[#c9a870] to-transparent" />
        <div className="px-5 py-9 sm:px-12 sm:py-12">
          {/* Heading: what this is, in one look */}
          <div className="mb-8 text-center">
            <div aria-hidden="true" className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-[#c9a870]/40 bg-[#c9a870]/10 text-[#c9a870] shadow-[0_0_30px_-8px_rgba(201,168,112,0.6)]">
              <CarFront className="h-7 w-7" strokeWidth={1.5} />
            </div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-[#c9a870]">Shop by vehicle</p>
            <h2 id="vehicle-finder-title" className="text-3xl font-light tracking-[-0.01em] text-[#f0ede7] sm:text-[42px] sm:leading-tight">
              Find parts that fit <em className="not-italic text-[#c9a870]">your car</em>
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-[#f0ede7]/70">
              Tell us your car in two taps — we&apos;ll show only the parts that fit it.
            </p>
          </div>

          {/* How it works: three numbered steps that light up as you go */}
          <ol aria-label="How it works" className="mx-auto mb-8 grid max-w-3xl grid-cols-3 gap-2 sm:gap-4">
            {([
              [1, 'Choose make'],
              [2, 'Choose model'],
              [3, 'Pick a category'],
            ] as const).map(([n, label]) => {
              const st = stepState(n);
              return (
                <li key={n} className="flex flex-col items-center gap-2 text-center sm:flex-row sm:justify-center sm:gap-3 sm:text-left">
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-semibold transition-colors ${
                      st === 'done'
                        ? 'border-[#c9a870] bg-[#c9a870] text-[#111212]'
                        : st === 'current'
                          ? 'border-[#c9a870] text-[#c9a870] shadow-[0_0_0_4px_rgba(201,168,112,0.15)]'
                          : 'border-white/20 text-[#f0ede7]/50'
                    }`}
                  >
                    {st === 'done' ? <Check className="h-4 w-4" strokeWidth={3} aria-hidden="true" /> : n}
                  </span>
                  <span className={`text-[11px] font-semibold uppercase tracking-[0.14em] sm:text-xs ${st === 'todo' ? 'text-[#f0ede7]/45' : 'text-[#f0ede7]'}`}>
                    {label}
                    {n === 3 && <span className="block text-[10px] font-normal normal-case tracking-normal text-[#f0ede7]/45">optional</span>}
                  </span>
                </li>
              );
            })}
          </ol>

          {/* Steps 1–2: vehicle */}
          <div className="mx-auto grid max-w-3xl gap-3 sm:grid-cols-2">
            <label className="relative block">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#c9a870]">1 · Make</span>
              <span className="relative block">
                <select
                  value={make}
                  onChange={(e) => { setMake(e.target.value); setModel(''); }}
                  className={selectClass}
                  aria-label="Car make"
                >
                  <option value="">Select your car make</option>
                  {makes.map((m) => <option key={m._id} value={m.name}>{m.name}</option>)}
                </select>
                <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#c9a870]" />
              </span>
            </label>
            <label className="relative block">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#c9a870]">2 · Model</span>
              <span className="relative block">
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  disabled={!make || loadingModels}
                  className={selectClass}
                  aria-label="Car model"
                >
                  <option value="">{!make ? 'Choose a make first' : loadingModels ? 'Loading models…' : 'Select your model'}</option>
                  {models.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#c9a870]" />
              </span>
            </label>
          </div>

          {/* Popular makes: one tap fills step 1 */}
          {popularMakes.length > 0 && !make && (
            <div className="mx-auto mt-4 flex max-w-3xl flex-wrap items-center justify-center gap-2">
              <span className="mr-1 text-[11px] uppercase tracking-[0.16em] text-[#f0ede7]/50">Popular:</span>
              {popularMakes.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => { setMake(name); setModel(''); }}
                  className="rounded-full border border-white/12 bg-white/[0.04] px-3.5 py-1.5 text-xs text-[#f0ede7]/85 transition-colors hover:border-[#c9a870]/70 hover:text-[#f0ede7]"
                >
                  {name}
                </button>
              ))}
            </div>
          )}

          {/* Step 3: category */}
          <div className="mt-9 border-t border-white/10 pt-7">
            <p id="finder-cat-label" className="mb-4 text-center text-[11px] font-semibold uppercase tracking-[0.2em] text-[#f0ede7]/60">
              <span className="text-[#c9a870]">3 · </span>{vehicleChosen ? 'Choose a category (optional)' : 'Choose a category'}
            </p>
            <div role="radiogroup" aria-labelledby="finder-cat-label" className="flex flex-wrap justify-center gap-2.5">
              {hubs.length === 0 && (
                <span className="text-sm text-[#f0ede7]/45">Loading categories…</span>
              )}
              {hubs.map((c) => {
                const active = c.slug === activeSlug;
                const count = countFor(c._id);
                return (
                  <button
                    key={c._id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setCategorySlug(active ? '' : c.slug!)}
                    className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] transition-all sm:px-5 sm:py-2.5 ${
                      active
                        ? 'border-[#c9a870] bg-[#c9a870] text-[#111212] shadow-[0_8px_22px_-10px_rgba(201,168,112,0.8)]'
                        : 'border-white/15 bg-white/[0.04] text-[#f0ede7]/90 hover:-translate-y-0.5 hover:border-[#c9a870]/70 hover:text-[#f0ede7]'
                    }`}
                  >
                    {c.name}
                    {count !== undefined && (
                      <span className={`ml-1.5 ${active ? 'text-[#111212]/70' : 'text-[#c9a870]'}`}>{count}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Search — always visible, live once a model (or a category) is chosen */}
          <div className="mt-9 flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={search}
              disabled={!ready}
              aria-disabled={!ready}
              className={`flex w-full max-w-md items-center justify-center gap-2.5 rounded-full py-4 text-sm font-bold uppercase tracking-[0.18em] transition-all ${
                ready
                  ? 'bg-[#c9a870] text-[#111212] shadow-[0_14px_36px_-10px_rgba(201,168,112,0.8)] hover:-translate-y-0.5 hover:brightness-110'
                  : 'cursor-not-allowed border border-white/12 bg-white/[0.04] text-[#f0ede7]/40'
              }`}
            >
              <Search className="h-4 w-4" /> Search parts
            </button>
            <p className="text-center text-sm text-[#f0ede7]/60" aria-live="polite">
              {vehicleChosen
                ? activeSlug
                  ? `${activeName} parts for ${make} ${model}`
                  : `All parts for ${make} ${model} — or pick a category above`
                : activeSlug
                  ? 'Tip: add your make and model to see only parts that fit'
                  : 'Start with your car make'}
            </p>
            <ul className="mt-1 flex flex-wrap justify-center gap-x-5 gap-y-1 text-xs text-[#f0ede7]/55">
              <li className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-[#c9a870]" aria-hidden="true" /> Only parts that fit your car</li>
              <li className="flex items-center gap-1.5"><Wrench className="h-3.5 w-3.5 text-[#c9a870]" aria-hidden="true" /> Free fitment advice</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
