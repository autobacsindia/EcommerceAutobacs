'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { vehicleService, Vehicle } from '@/services/vehicleService';
import StorePageHeader from '@/components/store/StorePageHeader';
import VehicleImage from '@/components/vehicles/VehicleImage';

/**
 * "Shop by Vehicle". Sourced from the backend `/vehicles` API (the single source of
 * truth used across the vehicle flow), NOT a hardcoded list — so every card shows a
 * real make + model, links to a slug that actually resolves, and the set stays in
 * sync as vehicles are added/removed in admin.
 *
 * Grouped by make with make chips and a quick filter, so a shopper with 80 cards in
 * front of them can get to their car in one tap or a few keystrokes.
 */
export default function VehiclesPage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [make, setMake] = useState<string>('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const all = await vehicleService.getAllVehicles();
        if (active) setVehicles(all);
      } catch {
        if (active) setError('Failed to load vehicles');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const makes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of vehicles) counts.set(v.make, (counts.get(v.make) || 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [vehicles]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = vehicles.filter(
      (v) => (!make || v.make === make) && (!q || `${v.make} ${v.model}`.toLowerCase().includes(q)),
    );
    const byMake = new Map<string, Vehicle[]>();
    for (const v of shown) byMake.set(v.make, [...(byMake.get(v.make) || []), v]);
    return [...byMake.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([m, list]) => [m, list.sort((a, b) => a.model.localeCompare(b.model))] as const);
  }, [vehicles, make, query]);

  const shownCount = groups.reduce((n, [, list]) => n + list.length, 0);

  return (
    <div className="sp sh-theme">
      <StorePageHeader
        crumbs={[{ label: 'Shop by vehicle' }]}
        title="Shop by vehicle"
        subtitle="Pick your car to see only the parts and accessories that fit it."
        aside={!loading && !error ? `${vehicles.length} vehicles · ${makes.length} makes` : undefined}
      >
        {/* Rendered from the first paint (disabled while loading) so the grid below
            does not jump down when the list arrives — that shift measured CLS 0.097. */}
        {!error && (
          <div className="mt-4 flex flex-col gap-3">
            <input
              disabled={loading}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type your car, e.g. Fortuner or City"
              aria-label="Find your vehicle"
              className="h-11 w-full max-w-md rounded-full border border-[#c9cfcd] bg-white px-5 text-[15px] text-ink outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
            />
            <div className="sp-chips min-h-[40px]" role="group" aria-label="Filter by make">
              <button type="button" className="sp-chip" aria-pressed={!make} onClick={() => setMake('')}>
                All makes
              </button>
              {makes.map(([m, n]) => (
                <button key={m} type="button" className="sp-chip" aria-pressed={make === m} onClick={() => setMake(make === m ? '' : m)}>
                  {m} <span className="sp-chip-n">{n}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </StorePageHeader>

      <div className="sp-wrap">
        {loading ? (
          <div className="sp-section sp-tiles" aria-busy="true">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="sp-tile">
                <div className="sp-tile-media animate-pulse" />
                <div className="sp-tile-body"><div className="h-4 w-2/3 animate-pulse rounded bg-obsidian-deep" /></div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="sp-section sp-card sp-empty">
            <p className="sp-empty-title">We couldn&apos;t load the vehicles</p>
            <p>Please check your connection and try again.</p>
            <button type="button" onClick={() => window.location.reload()} className="sh-btn sh-btn-primary">
              Try again
            </button>
          </div>
        ) : shownCount === 0 ? (
          <div className="sp-section sp-card sp-empty">
            <p className="sp-empty-title">{vehicles.length ? 'No vehicle matches that' : 'No vehicles yet'}</p>
            <p>Can&apos;t find your car? Our specialists can still help you find parts that fit.</p>
            <div className="flex flex-wrap justify-center gap-3">
              {vehicles.length > 0 && (
                <button type="button" className="sh-btn sh-btn-outline" onClick={() => { setQuery(''); setMake(''); }}>
                  Show all vehicles
                </button>
              )}
              <Link href="/consultation" className="sh-btn sh-btn-primary">Ask a specialist</Link>
            </div>
          </div>
        ) : (
          groups.map(([m, list]) => (
            <section key={m} className="sp-section" aria-labelledby={`make-${m}`}>
              <div className="sp-section-head">
                <h2 id={`make-${m}`} className="sp-h2">{m}</h2>
                <Link href={`/products?${new URLSearchParams({ vehicleMake: m }).toString()}`} className="st-link">
                  All {m} parts ›
                </Link>
              </div>
              <div className="sp-tiles">
                {list.map((vehicle) => (
                  <Link key={vehicle._id} href={`/model/${encodeURIComponent(vehicle.slug)}`} className="sp-tile">
                    <div className="sp-tile-media">
                      <VehicleImage
                        src={vehicle.image?.url}
                        alt={vehicle.image?.alt || `${vehicle.make} ${vehicle.model}`}
                        make={vehicle.make}
                      />
                    </div>
                    <div className="sp-tile-body">
                      <div>
                        <p className="sp-tile-name">{vehicle.model}</p>
                        <p className="sp-tile-sub">{vehicle.make}</p>
                      </div>
                      <span className="sp-tile-go" aria-hidden="true">›</span>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
