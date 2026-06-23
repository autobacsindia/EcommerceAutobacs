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
    <div className="min-h-screen bg-[#080808]">
      {/* Hero */}
      <div className="bg-[#0E0E0E] border-b border-[#252525] py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-[#3B9EE8] font-condensed font-bold text-sm uppercase tracking-widest mb-2">Vehicles</p>
          <h1 className="text-5xl font-condensed font-bold text-white uppercase tracking-wide mb-4">
            {vehicleMake} Parts & Accessories
          </h1>
          <p className="text-[#C4C4C4] font-body max-w-3xl mx-auto">
            Find the perfect parts and accessories for your {vehicleMake}
          </p>
        </div>
      </div>

      {/* Breadcrumb */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <nav className="text-sm font-body">
          <Link href="/" className="text-[#555555] hover:text-[#3B9EE8] transition-colors">Home</Link>
          <span className="mx-2 text-[#252525]">/</span>
          <Link href="/vehicles" className="text-[#555555] hover:text-[#3B9EE8] transition-colors">Vehicles</Link>
          <span className="mx-2 text-[#252525]">/</span>
          <span className="text-[#C4C4C4]">{vehicleMake}</span>
        </nav>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-condensed font-bold text-white uppercase tracking-wide mb-3">
            {vehicleMake} Parts & Accessories
          </h2>
          <p className="text-[#C4C4C4] font-body max-w-2xl mx-auto">
            Browse parts and accessories compatible with your {vehicleMake}
          </p>
        </div>

        {loading ? (
          <div className="text-center py-16">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#3B9EE8]"></div>
            <p className="mt-4 text-[#C4C4C4] font-body">Loading {vehicleMake} parts...</p>
          </div>
        ) : error ? (
          <div className="text-center py-16">
            <p className="text-red-400 font-body text-lg mb-4">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="bg-[#3B9EE8] hover:bg-[#1A6FB5] text-white font-condensed font-bold uppercase tracking-widest px-6 py-3 rounded-sm transition-colors"
            >
              Retry
            </button>
          </div>
        ) : vehicles.length > 0 ? (
          <div className="mb-12">
            <h3 className="text-xl font-condensed font-bold text-white uppercase tracking-wide mb-6 text-center">
              Available {vehicleMake} Models
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 mb-8">
              {vehicles.map((vehicle) => (
                <Link
                  key={vehicle._id}
                  href={`/model/${encodeURIComponent(vehicle.slug)}`}
                  className="group block"
                >
                  <div className="bg-[#0E0E0E] border border-[#252525] rounded-sm overflow-hidden hover:border-[#3B9EE8] transition-colors">
                    <div className="aspect-square bg-[#161616] flex items-center justify-center overflow-hidden">
                      {vehicle.image?.url ? (
                        <img
                          src={vehicle.image.url}
                          alt={vehicle.image.alt || `${vehicle.make} ${vehicle.model}`}
                          className="object-cover w-full h-full scale-110 group-hover:scale-125 transition-transform duration-500"
                          onError={(e) => { (e.target as HTMLImageElement).src = '/images/fallback-product.png'; }}
                          loading="lazy"
                        />
                      ) : (
                        <div className="text-[#555555] text-center p-4">
                          <svg className="mx-auto h-10 w-10 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                          </svg>
                          <span className="font-body text-xs">No image</span>
                        </div>
                      )}
                    </div>
                    <div className="p-3 text-center bg-[#161616] border-t border-[#252525]">
                      <h3 className="text-sm font-condensed font-bold text-[#C4C4C4] group-hover:text-[#3B9EE8] transition-colors uppercase tracking-wide">
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
                className="bg-[#3B9EE8] hover:bg-[#1A6FB5] text-white font-condensed font-bold uppercase tracking-widest px-8 py-3 rounded-sm transition-colors"
              >
                Browse All {vehicleMake} Parts
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center py-16">
            <p className="text-[#555555] font-body text-lg mb-6">No specific models found for {vehicleMake}</p>
            <button
              onClick={goToVehicleParts}
              className="bg-[#3B9EE8] hover:bg-[#1A6FB5] text-white font-condensed font-bold uppercase tracking-widest px-8 py-3 rounded-sm transition-colors"
            >
              Browse All {vehicleMake} Parts
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
