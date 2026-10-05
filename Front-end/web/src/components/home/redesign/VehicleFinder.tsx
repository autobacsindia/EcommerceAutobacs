'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Search } from 'lucide-react';
import { useVehicleMakes, useVehicleModels } from '@/hooks/queries/useVehicleMakes';
import { useCategories } from '@/hooks/queries/useCategories';
import { capture } from '@/lib/analytics';

/**
 * "Find parts for your car" — make → model → main category → Search.
 *
 * Lands on the category page with the vehicle filter applied
 * (/categories/<slug>?vehicleMake=Toyota&vehicleModel=Hilux); the category page
 * already honours both params through its filter sidebar, so there is no new
 * search path to keep in step.
 *
 * Search stays visible but dimmed and disabled until a category is picked, so
 * the next step is always obvious. Make and model narrow the result but are not
 * required — a visitor who only knows the category can still go.
 *
 * Built with Tailwind, so the root opts out of the home page's CSS reset
 * (`hr-unscoped`, see home-redesign.css) — otherwise the reset strips every
 * padding and margin utility.
 */

const selectClass =
  'w-full appearance-none rounded-md border border-white/15 bg-black/40 px-4 py-3.5 pr-10 text-sm text-[#f0ede7] transition-colors focus:border-[#c9a870] focus:outline-none focus:ring-2 focus:ring-[#c9a870]/25 disabled:cursor-not-allowed disabled:opacity-45';

export default function VehicleFinder() {
  const router = useRouter();
  const { data: makes = [] } = useVehicleMakes();
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [categorySlug, setCategorySlug] = useState('');
  const { data: models = [], isFetching: loadingModels } = useVehicleModels(make);
  const { data: categories } = useCategories();

  // Main categories only (no parent) that have a page to land on.
  const hubs = useMemo(
    () => (categories ?? []).filter((c) => !c.parent && c.slug).sort((a, b) => a.name.localeCompare(b.name)),
    [categories],
  );

  const ready = !!categorySlug;

  const search = () => {
    if (!ready) return;
    const params = new URLSearchParams();
    if (make) params.set('vehicleMake', make);
    if (make && model) params.set('vehicleModel', model);
    capture('vehicle_finder_search', { make, model, category: categorySlug });
    const qs = params.toString();
    router.push(`/categories/${encodeURIComponent(categorySlug)}${qs ? `?${qs}` : ''}`);
  };

  return (
    <section className="hr-unscoped relative z-10 px-4 py-12 sm:px-6 md:py-16" aria-labelledby="vehicle-finder-title">
      <div className="mx-auto max-w-5xl overflow-hidden rounded-xl border border-[#c9a870]/30 bg-[linear-gradient(160deg,#1a1b1b_0%,#101111_60%,#16130d_100%)] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9),0_0_60px_-20px_rgba(201,168,112,0.25)]">
        <div aria-hidden="true" className="h-1 bg-gradient-to-r from-[#c9a870]/30 via-[#c9a870] to-[#c9a870]/30" />
        <div className="px-5 py-8 sm:px-10 sm:py-10">
          <div className="mb-7 text-center">
            <p className="mb-2 text-[11px] uppercase tracking-[0.28em] text-[#c9a870]">Shop by vehicle</p>
            <h2 id="vehicle-finder-title" className="text-3xl font-light tracking-[-0.01em] text-[#f0ede7] sm:text-4xl">
              Find parts for your car
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-[#f0ede7]/65">
              Pick your make and model, choose a category, and see only the parts that fit.
            </p>
          </div>

          {/* Step 1–2: vehicle */}
          <div className="mx-auto grid max-w-3xl gap-3 sm:grid-cols-2">
            <label className="relative block">
              <span className="sr-only">Car make</span>
              <select
                value={make}
                onChange={(e) => { setMake(e.target.value); setModel(''); }}
                className={selectClass}
              >
                <option value="">Select make</option>
                {makes.map((m) => <option key={m._id} value={m.name}>{m.name}</option>)}
              </select>
              <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#c9a870]" />
            </label>
            <label className="relative block">
              <span className="sr-only">Car model</span>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={!make || loadingModels}
                className={selectClass}
              >
                <option value="">{!make ? 'Select model' : loadingModels ? 'Loading models…' : 'Select model'}</option>
                {models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#c9a870]" />
            </label>
          </div>

          {/* Step 3: category */}
          <div className="mt-8 border-t border-white/10 pt-7">
            <p id="finder-cat-label" className="mb-4 text-center text-[11px] uppercase tracking-[0.24em] text-[#f0ede7]/55">
              Choose a category
            </p>
            <div role="radiogroup" aria-labelledby="finder-cat-label" className="flex flex-wrap justify-center gap-2.5">
              {hubs.length === 0 && (
                <span className="text-sm text-[#f0ede7]/45">Loading categories…</span>
              )}
              {hubs.map((c) => {
                const active = c.slug === categorySlug;
                return (
                  <button
                    key={c._id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setCategorySlug(active ? '' : c.slug!)}
                    className={`rounded-full border px-4 py-2 text-xs font-medium uppercase tracking-[0.12em] transition-colors sm:px-5 sm:py-2.5 ${
                      active
                        ? 'border-[#c9a870] bg-[#c9a870] text-[#111212]'
                        : 'border-white/15 bg-white/[0.03] text-[#f0ede7]/85 hover:border-[#c9a870]/70 hover:text-[#f0ede7]'
                    }`}
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step 4: search — always visible, live only once a category is picked */}
          <div className="mt-8 flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={search}
              disabled={!ready}
              aria-disabled={!ready}
              className={`flex w-full max-w-sm items-center justify-center gap-2 rounded-md py-4 text-sm font-bold uppercase tracking-[0.18em] transition-all ${
                ready
                  ? 'bg-[#c9a870] text-[#111212] shadow-[0_12px_32px_-10px_rgba(201,168,112,0.7)] hover:brightness-110'
                  : 'cursor-not-allowed border border-white/10 bg-white/[0.04] text-[#f0ede7]/35'
              }`}
            >
              <Search className="h-4 w-4" /> Search parts
            </button>
            <p className="text-xs text-[#f0ede7]/45" aria-live="polite">
              {ready
                ? make && model
                  ? `Showing ${hubs.find((h) => h.slug === categorySlug)?.name ?? ''} parts for ${make} ${model}`
                  : 'Tip: add your make and model to see only parts that fit'
                : 'Choose a category to search'}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
