'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { vehicleService, Vehicle } from '@/services/vehicleService';

export default function VehicleMakePage({ params }: { params: Promise<{ make: string }> }) {
  const router = useRouter();
  const paramsValue = use(params);
  const { make } = paramsValue;
  const vehicleMake = decodeURIComponent(make);

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchVehicles = async () => {
      try {
        setLoading(true);
        const allVehicles = await vehicleService.getAllVehicles();
        setVehicles(allVehicles.filter(v => v.make.toLowerCase() === vehicleMake.toLowerCase()));
      } catch (err) {
        setError('Failed to load vehicles');
      } finally {
        setLoading(false);
      }
    };
    fetchVehicles();
  }, [vehicleMake]);

  const goToVehicleParts = () => {
    if (vehicles.length > 0) router.push(`/model/${encodeURIComponent(vehicles[0].slug)}`);
    else router.push(`/model/${encodeURIComponent(vehicleMake.toLowerCase().replace(/\s+/g, '-'))}`);
  };

  return (
    <div className="min-h-screen bg-obsidian-deep">
      {/* Hero */}
      <div className="bg-obsidian border-b border-hairline py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-gold font-display font-bold text-sm uppercase tracking-widest mb-2">Vehicles</p>
          <h1 className="text-5xl font-display font-bold text-ink uppercase tracking-wide mb-4">
            {vehicleMake} Parts & Accessories
          </h1>
          <p className="text-ink/70 font-display max-w-3xl mx-auto">
            Find the perfect parts and accessories for your {vehicleMake}
          </p>
        </div>
      </div>

      {/* Breadcrumb */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <nav className="text-sm font-display">
          <Link href="/" className="text-ink-muted hover:text-gold transition-colors">Home</Link>
          <span className="mx-2 text-hairline">/</span>
          <Link href="/vehicles" className="text-ink-muted hover:text-gold transition-colors">Vehicles</Link>
          <span className="mx-2 text-hairline">/</span>
          <span className="text-ink/70">{vehicleMake}</span>
        </nav>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-display font-bold text-ink uppercase tracking-wide mb-3">
            {vehicleMake} Parts & Accessories
          </h2>
          <p className="text-ink/70 font-display max-w-2xl mx-auto">
            Browse parts and accessories compatible with your {vehicleMake}
          </p>
        </div>

        {loading ? (
          <div className="text-center py-16">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-gold"></div>
            <p className="mt-4 text-ink/70 font-display">Loading {vehicleMake} parts...</p>
          </div>
        ) : error ? (
          <div className="text-center py-16">
            <p className="text-red-400 font-display text-lg mb-4">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="bg-gold hover:bg-gold text-obsidian font-display font-bold uppercase tracking-widest px-6 py-3 rounded-sm transition-colors"
            >
              Retry
            </button>
          </div>
        ) : vehicles.length > 0 ? (
          <div className="mb-12">
            <h3 className="text-xl font-display font-bold text-ink uppercase tracking-wide mb-6 text-center">
              Available {vehicleMake} Models
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 mb-8">
              {vehicles.map((vehicle) => (
                <Link
                  key={vehicle._id}
                  href={`/model/${encodeURIComponent(vehicle.slug)}`}
                  className="group block"
                >
                  <div className="bg-obsidian border border-hairline rounded-sm overflow-hidden hover:border-gold transition-colors">
                    <div className="aspect-square bg-obsidian-raised flex items-center justify-center overflow-hidden">
                      {vehicle.image?.url ? (
                        <img
                          src={vehicle.image.url}
                          alt={vehicle.image.alt || `${vehicle.make} ${vehicle.model}`}
                          className="object-cover w-full h-full scale-110 group-hover:scale-125 transition-transform duration-500"
                          onError={(e) => { (e.target as HTMLImageElement).src = '/images/fallback-product.png'; }}
                          loading="lazy"
                        />
                      ) : (
                        <div className="text-ink-muted text-center p-4">
                          <svg className="mx-auto h-10 w-10 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                          </svg>
                          <span className="font-display text-xs">No image</span>
                        </div>
                      )}
                    </div>
                    <div className="p-3 text-center bg-obsidian-raised border-t border-hairline">
                      <h3 className="text-sm font-display font-bold text-ink/70 group-hover:text-gold transition-colors uppercase tracking-wide">
                        {vehicle.model}
                      </h3>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
            <div className="text-center">
              <button
                onClick={goToVehicleParts}
                className="bg-gold hover:bg-gold text-obsidian font-display font-bold uppercase tracking-widest px-8 py-3 rounded-sm transition-colors"
              >
                Browse All {vehicleMake} Parts
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center py-16">
            <p className="text-ink-muted font-display text-lg mb-6">No specific models found for {vehicleMake}</p>
            <button
              onClick={goToVehicleParts}
              className="bg-gold hover:bg-gold text-obsidian font-display font-bold uppercase tracking-widest px-8 py-3 rounded-sm transition-colors"
            >
              Browse All {vehicleMake} Parts
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
