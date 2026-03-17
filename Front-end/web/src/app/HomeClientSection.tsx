'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { VehicleSelectorSkeleton } from '@/components/skeletons/VehicleSelectorSkeleton';

const VehicleSelector = dynamic(() => import('@/components/vehicles/VehicleSelector'), {
  ssr: false,
  loading: () => <VehicleSelectorSkeleton />,
});

const RecentlyViewedProducts = dynamic(() => import('@/components/products/RecentlyViewedProducts'), {
  ssr: false,
});

export function VehicleSelectorSection() {
  const [selectedVehicle, setSelectedVehicle] = useState({ make: '', model: '' });

  const handleVehicleSelect = useCallback((make: string, model: string) => {
    setSelectedVehicle({ make, model });
  }, []);

  const generateVehicleSlug = (make: string, model: string) =>
    `${make.toLowerCase().replace(/\s+/g, '-')}-${model.toLowerCase().replace(/\s+/g, '-')}`;

  return (
    <div className="max-w-2xl mx-auto">
      <VehicleSelector onVehicleSelect={handleVehicleSelect} />
      {selectedVehicle.make && selectedVehicle.model && (
        <div className="mt-6 text-center">
          <Link
            href={`/model/${generateVehicleSlug(selectedVehicle.make, selectedVehicle.model)}`}
            className="inline-block bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors"
          >
            View {selectedVehicle.make} {selectedVehicle.model} Parts
          </Link>
        </div>
      )}
    </div>
  );
}

export function RecentlyViewedSection() {
  return <RecentlyViewedProducts />;
}
