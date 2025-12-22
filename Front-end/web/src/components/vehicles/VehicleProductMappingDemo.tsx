'use client';

import { useState, useEffect } from 'react';
import { wordpressService, WordPressVehicle, WordPressProduct } from '@/services/wordpressService';

export default function VehicleProductMappingDemo() {
  const [vehicles, setVehicles] = useState<WordPressVehicle[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<WordPressVehicle | null>(null);
  const [products, setProducts] = useState<WordPressProduct[]>([]);
  const [loading, setLoading] = useState({ vehicles: true, products: false });
  const [error, setError] = useState<string | null>(null);

  // Fetch all vehicles on component mount
  useEffect(() => {
    const fetchVehicles = async () => {
      try {
        setLoading(prev => ({ ...prev, vehicles: true }));
        const vehiclesData = await wordpressService.getAllVehicles();
        setVehicles(vehiclesData);
        
        // Auto-select the first vehicle if available
        if (vehiclesData.length > 0) {
          setSelectedVehicle(vehiclesData[0]);
        }
      } catch (err: any) {
        console.error('Error fetching vehicles:', err);
        setError(err.message || 'Failed to load vehicles');
      } finally {
        setLoading(prev => ({ ...prev, vehicles: false }));
      }
    };

    fetchVehicles();
  }, []);

  // Fetch products when a vehicle is selected
  useEffect(() => {
    const fetchProducts = async () => {
      if (!selectedVehicle) return;
      
      try {
        setLoading(prev => ({ ...prev, products: true }));
        const productsData = await wordpressService.getProductsByVehicle(selectedVehicle.slug);
        setProducts(productsData);
      } catch (err: any) {
        console.error('Error fetching products:', err);
        setError(err.message || 'Failed to load products');
      } finally {
        setLoading(prev => ({ ...prev, products: false }));
      }
    };

    fetchProducts();
  }, [selectedVehicle]);

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Vehicle-to-Product Mapping Demo</h1>
      
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <p className="text-red-700">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Vehicle Selection Panel */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-lg shadow-md p-6 sticky top-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Select a Vehicle</h2>
            
            {loading.vehicles ? (
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-12 bg-gray-200 rounded animate-pulse"></div>
                ))}
              </div>
            ) : vehicles.length > 0 ? (
              <div className="space-y-2">
                {vehicles.map(vehicle => (
                  <button
                    key={vehicle.id}
                    onClick={() => setSelectedVehicle(vehicle)}
                    className={`w-full text-left p-3 rounded-lg transition-colors ${
                      selectedVehicle?.id === vehicle.id
                        ? 'bg-blue-100 border border-blue-300 text-blue-700'
                        : 'hover:bg-gray-100 border border-transparent'
                    }`}
                  >
                    <div className="font-medium">{vehicle.name}</div>
                    <div className="text-sm text-gray-500">{vehicle.count} products</div>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-gray-500">No vehicles found</p>
            )}
          </div>
        </div>

        {/* Products Display */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-gray-900">
                {selectedVehicle 
                  ? `${selectedVehicle.name} Products` 
                  : 'Select a Vehicle'}
              </h2>
              {selectedVehicle && (
                <span className="bg-blue-100 text-blue-800 text-sm font-medium px-3 py-1 rounded-full">
                  {products.length} products
                </span>
              )}
            </div>

            {loading.products ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="border rounded-lg p-4 animate-pulse">
                    <div className="h-32 bg-gray-200 rounded mb-4"></div>
                    <div className="h-4 bg-gray-200 rounded mb-2"></div>
                    <div className="h-4 bg-gray-200 rounded w-2/3 mb-4"></div>
                    <div className="h-6 bg-gray-200 rounded w-1/3"></div>
                  </div>
                ))}
              </div>
            ) : selectedVehicle ? (
              products.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {products.map(product => (
                    <div key={product.id} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                      <div className="flex gap-4">
                        {product.images && product.images.length > 0 ? (
                          <img 
                            src={product.images[0].src} 
                            alt={product.images[0].alt || product.name}
                            className="w-20 h-20 object-cover rounded"
                          />
                        ) : (
                          <div className="w-20 h-20 bg-gray-200 rounded flex items-center justify-center">
                            <span className="text-gray-500 text-xs">No image</span>
                          </div>
                        )}
                        
                        <div className="flex-1">
                          <h3 className="font-medium text-gray-900">{product.name}</h3>
                          <p className="text-sm text-gray-500 mb-2">
                            {product.categories.map(cat => cat.name).join(', ')}
                          </p>
                          <div className="flex justify-between items-center">
                            <span className="font-bold text-blue-600">
                              ₹{product.price}
                            </span>
                            {product.on_sale && (
                              <span className="text-xs bg-red-100 text-red-800 px-2 py-1 rounded">
                                On Sale
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <p className="text-gray-500 mb-4">No products found for {selectedVehicle.name}</p>
                  <button
                    onClick={() => setSelectedVehicle(null)}
                    className="text-blue-600 hover:text-blue-700 font-medium"
                  >
                    Select a different vehicle
                  </button>
                </div>
              )
            ) : (
              <div className="text-center py-12">
                <p className="text-gray-500">Select a vehicle to view its products</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mapping Visualization */}
      {vehicles.length > 0 && (
        <div className="mt-8 bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Vehicle-to-Product Mapping</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Vehicle
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Product Count
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Sample Products
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {vehicles.map(vehicle => (
                  <tr key={vehicle.id}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="font-medium text-gray-900">{vehicle.name}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">
                        {vehicle.count}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-500">
                        {products
                          .filter(p => selectedVehicle?.id === vehicle.id)
                          .slice(0, 3)
                          .map(p => p.name)
                          .join(', ') || '-'}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}