'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Vehicle {
  _id: string;
  make: string;
  model: string;
  slug: string;
  name: string;
  image?: {
    url: string;
    alt: string;
  };
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

import { ALL_VEHICLES } from '@/lib/vehicleData';

const staticVehicles: Vehicle[] = ALL_VEHICLES.map(vehicle => ({
  _id: vehicle.id.toString(),
  make: vehicle.make,
  model: vehicle.name.replace(vehicle.make + ' ', ''),
  slug: vehicle.slug,
  name: vehicle.name,
  isActive: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  image: { url: vehicle.image, alt: vehicle.name }
}));

export default function VehiclesPage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>(staticVehicles);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setVehicles(staticVehicles);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#080808]">
        <div className="bg-[#0E0E0E] border-b border-[#252525] py-20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <p className="text-[#3B9EE8] font-condensed font-bold text-sm uppercase tracking-widest mb-3">Browse by Vehicle</p>
            <h1 className="text-5xl font-condensed font-bold text-white uppercase tracking-wide mb-4">Explore by Vehicle</h1>
            <p className="text-[#C4C4C4] font-body text-lg max-w-3xl mx-auto">
              Find the perfect parts and accessories for your vehicle
            </p>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            {[...Array(10)].map((_, index) => (
              <div key={index} className="bg-[#0E0E0E] border border-[#252525] rounded-lg overflow-hidden animate-pulse">
                <div className="aspect-square bg-[#161616]" />
                <div className="p-3 bg-[#0E0E0E]">
                  <div className="h-4 bg-[#252525] rounded w-3/4 mx-auto" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#080808] flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-condensed font-bold text-red-400 uppercase mb-4">Error Loading Vehicles</h2>
          <p className="text-[#C4C4C4] font-body mb-6">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="bg-[#3B9EE8] hover:bg-[#1A6FB5] text-white font-condensed font-bold uppercase tracking-widest px-6 py-3 rounded-sm transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#080808]">
      {/* Hero */}
      <div className="bg-[#0E0E0E] border-b border-[#252525] py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-[#3B9EE8] font-condensed font-bold text-sm uppercase tracking-widest mb-3">Browse by Vehicle</p>
          <h1 className="text-5xl font-condensed font-bold text-white uppercase tracking-wide mb-4">Explore by Vehicle</h1>
          <p className="text-[#C4C4C4] font-body text-lg max-w-3xl mx-auto">
            Find the perfect parts and accessories for your vehicle
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-condensed font-bold text-white uppercase tracking-wide mb-2">All Vehicles</h2>
          <p className="text-[#C4C4C4] font-body max-w-2xl mx-auto">
            Select your vehicle make to browse compatible parts and accessories
          </p>
        </div>

        {vehicles.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-[#555555] font-body text-lg">No vehicles found.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            {vehicles.map((vehicle) => (
              <Link
                key={vehicle._id}
                href={`/model/${encodeURIComponent(vehicle.slug)}`}
                className="group block"
              >
                <div className="bg-[#0E0E0E] border border-[#252525] rounded-lg overflow-hidden hover:border-[#3B9EE8] transition-all duration-300">
                  <div className="aspect-square bg-[#161616] flex items-center justify-center overflow-hidden">
                    <img
                      src={vehicle.image?.url || `/images/vehicles/${vehicle.slug}.jpg`}
                      alt={vehicle.name || vehicle.make + ' ' + vehicle.model}
                      className="object-cover w-full h-full scale-110 group-hover:scale-125 transition-transform duration-500"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        if (target.src.includes('.jpg')) {
                          target.src = `/images/vehicles/${vehicle.slug}.svg`;
                          target.onerror = () => { target.src = '/images/fallback-product.png'; };
                        } else {
                          target.src = '/images/fallback-product.png';
                        }
                      }}
                      loading="lazy"
                    />
                  </div>
                  <div className="p-3 text-center bg-[#0E0E0E] border-t border-[#252525]">
                    <h3 className="text-sm font-condensed font-bold text-white uppercase tracking-wide group-hover:text-[#3B9EE8] transition-colors">
                      {vehicle.name}
                    </h3>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
