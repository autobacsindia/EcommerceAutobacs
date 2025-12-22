'use client';

import { useState, useEffect } from 'react';
import { wordpressService } from '@/services/wordpressService';

export default function TestWordPressConnection() {
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const testConnection = async () => {
      try {
        setLoading(true);
        const vehiclesData = await wordpressService.getAllVehicles();
        setVehicles(vehiclesData);
        console.log('Vehicles data:', vehiclesData);
      } catch (err: any) {
        console.error('Error testing WordPress connection:', err);
        setError(err.message || 'Failed to connect to WordPress API');
      } finally {
        setLoading(false);
      }
    };

    testConnection();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <h1 className="text-3xl font-bold mb-6">WordPress API Test</h1>
      
      {loading ? (
        <p>Loading vehicles...</p>
      ) : error ? (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
          <p>Error: {error}</p>
        </div>
      ) : (
        <div>
          <h2 className="text-xl font-semibold mb-4">Vehicles Found: {vehicles.length}</h2>
          <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {vehicles.map((vehicle) => (
              <li key={vehicle.id} className="bg-white p-4 rounded shadow">
                <h3 className="font-bold">{vehicle.name}</h3>
                <p>Slug: {vehicle.slug}</p>
                <p>Count: {vehicle.count}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}