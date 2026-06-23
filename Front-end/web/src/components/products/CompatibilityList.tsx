'use client';

import { Car, Check } from 'lucide-react';

interface CompatibilityListProps {
  vehicles?: Array<{
    make: string;
    model: string;
  }>;
}

export default function CompatibilityList({ vehicles }: CompatibilityListProps) {
  if (!vehicles || vehicles.length === 0) {
    return null;
  }

  return (
    <section className="bg-white rounded-2xl p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Car className="w-6 h-6 text-blue-600" />
        <h2 className="text-xl font-bold text-gray-900">Vehicle Compatibility</h2>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {vehicles.map((vehicle, index) => (
          <div
            key={index}
            className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-green-50 transition-colors"
          >
            <Check className="w-5 h-5 text-green-600 flex-shrink-0" />
            <div>
              <p className="font-medium text-gray-900">
                {vehicle.make} {vehicle.model}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
