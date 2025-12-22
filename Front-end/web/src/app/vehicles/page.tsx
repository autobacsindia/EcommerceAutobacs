'use client';

import Link from 'next/link';
import WordPressDiagnostics from '@/components/vehicles/WordPressDiagnostics';

// Static vehicle data matching https://autobacsindia.com/vehicles/
const vehicles = [
  { id: 1, name: 'Toyota Hilux', slug: 'toyota-hilux', image: '/images/vehicles/toyota-hilux.jpg' },
  { id: 2, name: 'Mahindra Thar', slug: 'mahindra-thar', image: '/images/vehicles/mahindra-thar.jpg' },
  { id: 3, name: 'Isuzu Dmax-v cross', slug: 'isuzu-dmax-v-cross', image: '/images/vehicles/isuzu-dmax-v-cross.jpg' },
  { id: 4, name: 'Maruti Jimny', slug: 'maruti-jimny', image: '/images/vehicles/maruti-jimny.jpg' },
  { id: 5, name: 'Jeep Wrangler', slug: 'jeep-wrangler', image: '/images/vehicles/jeep-wrangler.jpg' },
  { id: 6, name: 'Toyota Fortuner', slug: 'toyota-fortuner', image: '/images/vehicles/toyota-fortuner.jpg' },
  { id: 7, name: 'Volkswagen Polo', slug: 'volkswagen-polo', image: '/images/vehicles/volkswagen-polo.jpg' },
  { id: 8, name: 'Hyundai', slug: 'hyundai', image: '/images/vehicles/hyundai.jpg' },
  { id: 9, name: 'KIA', slug: 'kia', image: '/images/vehicles/kia.jpg' },
  { id: 10, name: 'Ford Endeavour', slug: 'ford-endeavour', image: '/images/vehicles/ford-endeavour.jpg' },
  { id: 11, name: 'Audi', slug: 'audi', image: '/images/vehicles/audi.jpg' },
  { id: 12, name: 'BMW', slug: 'bmw', image: '/images/vehicles/bmw.jpg' },
  { id: 13, name: 'Ford Ranger', slug: 'ford-ranger', image: '/images/vehicles/ford-ranger.jpg' },
  { id: 14, name: 'Land Rover Defender', slug: 'land-rover-defender', image: '/images/vehicles/land-rover-defender.jpg' },
  { id: 15, name: 'Mercedes Benz', slug: 'mercedes-benz', image: '/images/vehicles/mercedes-benz.jpg' },
];

export default function VehiclesPage() {
  return (
    <div className="min-h-screen bg-white">
      <WordPressDiagnostics />
      
      {/* Hero Section */}
      <div className="bg-gradient-to-r from-blue-900 to-black text-white py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-5xl font-bold mb-6">Explore by Vehicle</h1>
          <p className="text-xl text-gray-300 max-w-3xl mx-auto">
            Find the perfect parts and accessories for your vehicle
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">All Vehicles</h2>
          <p className="text-gray-600 text-lg max-w-2xl mx-auto">
            Select your vehicle make to browse compatible parts and accessories
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-8">
          {vehicles.map((vehicle) => (
            <Link
              key={vehicle.id}
              href={`/vehicles/${encodeURIComponent(vehicle.slug)}`}
              className="group block bg-white rounded-xl overflow-hidden shadow-md hover:shadow-xl transition-all duration-300 border border-gray-100"
            >
              <div className="h-32 bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center relative overflow-hidden">
                <img 
                  src={vehicle.image} 
                  alt={vehicle.name}
                  className="object-cover w-full h-full transition-transform duration-300 group-hover:scale-110"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    // Try SVG version if JPG fails
                    if (target.src.endsWith('.jpg')) {
                      target.src = target.src.replace('.jpg', '.svg');
                    } else {
                      target.src = '/images/fallback-product.png';
                    }
                  }}
                />
                <div className="absolute inset-0 bg-black bg-opacity-30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  <h3 className="text-xl font-bold text-white text-center px-2">
                    {vehicle.name}
                  </h3>
                </div>
                <h3 className="absolute bottom-0 left-0 right-0 text-xl font-bold text-gray-800 bg-white bg-opacity-90 p-2 text-center truncate">
                  {vehicle.name}
                </h3>
              </div>
              <div className="p-5 bg-white border-t border-gray-100">
                <p className="text-sm text-gray-500 text-center">
                  Products
                </p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}