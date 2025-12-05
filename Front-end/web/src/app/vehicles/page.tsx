'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ALL_VEHICLES } from '@/lib/vehicleData';

export default function VehiclesPage() {
  const [loading] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero Section */}
      <div className="bg-black text-white py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl font-bold mb-4">Explore by Vehicle</h1>
          <p className="text-xl text-gray-300">
            Find the perfect parts for your vehicle
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">All Vehicles</h2>
          <p className="text-gray-600 max-w-2xl mx-auto">
            Select your vehicle make to browse compatible parts and accessories
          </p>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-6">
            {[...Array(12)].map((_, index) => (
              <div key={index} className="bg-white rounded-lg shadow-md overflow-hidden animate-pulse">
                <div className="h-24 bg-gray-200"></div>
                <div className="p-4">
                  <div className="h-4 bg-gray-200 rounded"></div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-8">
            {ALL_VEHICLES.map((vehicle) => (
              <Link
                key={vehicle.id}
                href={`/vehicles/${encodeURIComponent(vehicle.make)}`}
                className="group block bg-white rounded-xl shadow-md overflow-hidden hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-1"
              >
                <div className="aspect-square bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center overflow-hidden">
                  {vehicle.image ? (
                    <Image
                      src={vehicle.image}
                      alt={vehicle.name}
                      width={300}
                      height={300}
                      className="object-cover w-full h-full scale-110 group-hover:scale-125 transition-transform duration-500"
                    />
                  ) : (
                    <div className="text-center">
                      <div className="text-3xl font-bold text-gray-700 mb-2">
                        {vehicle.make.toUpperCase()}
                      </div>
                    </div>
                  )}
                </div>
                <div className="p-6 bg-white">
                  <h3 className="font-bold text-gray-900 text-center text-lg group-hover:text-blue-600 transition-colors">
                    {vehicle.name}
                  </h3>
                  <p className="text-sm text-gray-500 text-center mt-2">View Parts</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}