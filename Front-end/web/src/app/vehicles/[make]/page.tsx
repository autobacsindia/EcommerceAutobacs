'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';
import { vehicleService, Vehicle } from '@/services/vehicleService';
import StorePageHeader from '@/components/store/StorePageHeader';
import VehicleImage from '@/components/vehicles/VehicleImage';

/** One make's models, plus a shortcut to every part for the make. */
export default function VehicleMakePage({ params }: { params: Promise<{ make: string }> }) {
  const { make } = use(params);
  const vehicleMake = decodeURIComponent(make);

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true);
        const all = await vehicleService.getAllVehicles();
        if (active) {
          setVehicles(
            all
              .filter((v) => v.make.toLowerCase() === vehicleMake.toLowerCase())
              .sort((a, b) => a.model.localeCompare(b.model)),
          );
        }
      } catch {
        if (active) setError('Failed to load vehicles');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [vehicleMake]);

  // Stored casing (e.g. "Land Rover") when we have it, so the product filter matches.
  const makeName = vehicles[0]?.make || vehicleMake;
  // Every part for the make — previously this button opened the FIRST model's page.
  const allPartsHref = `/products?${new URLSearchParams({ vehicleMake: makeName }).toString()}`;

  return (
    <div className="sp sh-theme">
      <StorePageHeader
        crumbs={[{ label: 'Shop by vehicle', href: '/vehicles' }, { label: makeName }]}
        title={`${makeName} parts & accessories`}
        subtitle={`Choose your ${makeName} model to see the parts that fit it.`}
        aside={<Link href={allPartsHref} className="sh-btn sh-btn-primary">Shop all {makeName} parts</Link>}
      />

      <div className="sp-wrap">
        {loading ? (
          <div className="sp-section sp-tiles" aria-busy="true">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="sp-tile">
                <div className="sp-tile-media animate-pulse" />
                <div className="sp-tile-body"><div className="h-4 w-2/3 animate-pulse rounded bg-obsidian-deep" /></div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="sp-section sp-card sp-empty">
            <p className="sp-empty-title">We couldn&apos;t load the models</p>
            <p>Please check your connection and try again.</p>
            <button type="button" onClick={() => window.location.reload()} className="sh-btn sh-btn-primary">Try again</button>
          </div>
        ) : vehicles.length > 0 ? (
          <section className="sp-section" aria-labelledby="models-title">
            <div className="sp-section-head">
              <h2 id="models-title" className="sp-h2">{makeName} models</h2>
              <span className="text-sm text-ink-muted">{vehicles.length} {vehicles.length === 1 ? 'model' : 'models'}</span>
            </div>
            <div className="sp-tiles">
              {vehicles.map((vehicle) => (
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
                      <p className="sp-tile-sub">View parts</p>
                    </div>
                    <span className="sp-tile-go" aria-hidden="true">›</span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ) : (
          <div className="sp-section sp-card sp-empty">
            <p className="sp-empty-title">No {makeName} models listed yet</p>
            <p>You can still browse every part we carry for {makeName}.</p>
            <Link href={allPartsHref} className="sh-btn sh-btn-primary">Shop all {makeName} parts</Link>
          </div>
        )}
      </div>
    </div>
  );
}
