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
      <div className="min-h-screen bg-obsidian-deep">
        <div className="bg-obsidian border-b border-hairline py-20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <p className="font-display text-[10px] uppercase tracking-[0.28em] text-gold mb-3">Browse by Vehicle</p>
            <h1 className="text-5xl font-display font-light text-ink tracking-[-0.01em] mb-4">Explore by Vehicle</h1>
            <p className="text-ink/70 font-display text-lg max-w-3xl mx-auto">
              Find the perfect parts and accessories for your vehicle
            </p>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            {[...Array(10)].map((_, index) => (
              <div key={index} className="bg-obsidian border border-hairline rounded-lg overflow-hidden animate-pulse">
                <div className="aspect-square bg-obsidian-raised" />
                <div className="p-3 bg-obsidian">
                  <div className="h-4 bg-obsidian-raised rounded w-3/4 mx-auto" />
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
      <div className="min-h-screen bg-obsidian-deep flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-display font-bold text-red-400 uppercase mb-4">Error Loading Vehicles</h2>
          <p className="text-ink/70 font-display mb-6">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="bg-gold hover:opacity-90 text-obsidian font-display font-bold uppercase tracking-widest px-6 py-3 rounded-sm transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-obsidian-deep">
      {/* Hero */}
      <div className="bg-obsidian border-b border-hairline py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="font-display text-[10px] uppercase tracking-[0.28em] text-gold mb-3">Browse by Vehicle</p>
          <h1 className="text-5xl font-display font-light text-ink tracking-[-0.01em] mb-4">Explore by Vehicle</h1>
          <p className="text-ink/70 font-display text-lg max-w-3xl mx-auto">
            Find the perfect parts and accessories for your vehicle
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-display font-light text-ink tracking-[-0.01em] mb-2">All Vehicles</h2>
          <p className="text-ink/70 font-display max-w-2xl mx-auto">
            Select your vehicle make to browse compatible parts and accessories
          </p>
        </div>

        {vehicles.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-ink-muted font-display text-lg">No vehicles found.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            {vehicles.map((vehicle) => (
              <Link
                key={vehicle._id}
                href={`/model/${encodeURIComponent(vehicle.slug)}`}
                className="group block"
              >
                <div className="bg-obsidian border border-hairline rounded-lg overflow-hidden hover:border-gold transition-all duration-300">
                  <div className="aspect-square bg-obsidian-raised flex items-center justify-center overflow-hidden">
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
                  <div className="p-3 text-center bg-obsidian border-t border-hairline">
                    <h3 className="text-sm font-display font-light text-ink tracking-[-0.01em] group-hover:text-gold transition-colors">
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
