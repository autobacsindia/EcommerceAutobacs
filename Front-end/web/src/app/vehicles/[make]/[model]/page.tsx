'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Package } from 'lucide-react';
import { vehicleService, Vehicle } from '@/services/vehicleService';
import apiClient from '@/lib/api';

export default function VehicleModelPage({ params }: { params: Promise<{ make: string; model: string }> }) {
  const router = useRouter();
  
  // Unwrap the params Promise
  const paramsValue = use(params);
  const { make, model } = paramsValue;
  const vehicleMake = decodeURIComponent(make);
  const vehicleModel = decodeURIComponent(model);
  
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch vehicle and products
  useEffect(() => {
    const fetchVehicleAndProducts = async () => {
      try {
        setLoading(true);
        
        // Fetch vehicle products directly using the public endpoint
        const productsResponse: any = await apiClient.get(
          `/vehicles/make-model/${encodeURIComponent(vehicleMake)}/${encodeURIComponent(vehicleModel)}/products`
        );
        
        if (productsResponse.success && productsResponse.vehicle) {
          setProducts(productsResponse.products || []);
        } else {
          setError('Vehicle not found');
        }
      } catch (err) {
        console.error('Error fetching vehicle:', err);
        setError('Failed to load vehicle details');
      } finally {
        setLoading(false);
      }
    };

    fetchVehicleAndProducts();
  }, [vehicleMake, vehicleModel]);

  if (loading) {
    return (
      <div className="min-h-screen bg-obsidian-deep flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto"></div>
          <p className="mt-4 text-ink-muted">Loading vehicle details...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-obsidian-deep flex items-center justify-center">
        <div className="text-center">
          <Package className="h-16 w-16 text-ink-muted mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-ink mb-2">Vehicle Not Found</h2>
          <p className="text-ink-muted mb-6">{error}</p>
          <Link
            href="/vehicles"
            className="inline-flex items-center gap-2 px-6 py-3 bg-green-600 text-ink rounded-lg hover:bg-green-700 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Vehicles
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-obsidian-deep">
      {/* Header */}
      <div className="bg-obsidian border-b border-hairline">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <Link
            href={`/vehicles/${vehicleMake}`}
            className="inline-flex items-center gap-2 text-ink-muted hover:text-ink mb-4"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to {vehicleMake} Vehicles
          </Link>
          <h1 className="text-3xl font-bold text-ink">
            {vehicleMake.charAt(0).toUpperCase() + vehicleMake.slice(1)} {vehicleModel.charAt(0).toUpperCase() + vehicleModel.slice(1)}
          </h1>
          <p className="mt-2 text-ink-muted">
            {products.length} compatible {products.length === 1 ? 'product' : 'products'} found
          </p>
        </div>
      </div>

      {/* Products Grid */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {products.length === 0 ? (
          <div className="text-center py-12">
            <Package className="h-16 w-16 text-ink-muted mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-ink mb-2">No Products Found</h3>
            <p className="text-ink-muted mb-6">
              We don't have any products compatible with {vehicleMake} {vehicleModel} yet.
            </p>
            <Link
              href="/products"
              className="inline-flex items-center gap-2 px-6 py-3 bg-green-600 text-ink rounded-lg hover:bg-green-700 transition-colors"
            >
              Browse All Products
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {products.map((product: any) => (
              <Link
                key={product._id}
                href={`/products/${product.slug || product._id}`}
                className="bg-obsidian rounded-lg shadow-sm border border-hairline overflow-hidden hover:shadow-md transition-shadow"
              >
                {product.images?.[0] && (
                  <div className="aspect-square bg-obsidian-raised">
                    <img
                      src={product.images[0].url}
                      alt={product.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                <div className="p-4">
                  <h3 className="font-semibold text-ink mb-2 line-clamp-2">
                    {product.name}
                  </h3>
                  <div className="flex items-center justify-between">
                    <span className="text-lg font-bold text-green-600">
                      ₹{product.price?.toLocaleString('en-IN')}
                    </span>
                    {product.stock !== 'out' ? (
                      <span className="text-xs text-green-600 font-medium">In Stock</span>
                    ) : (
                      <span className="text-xs text-red-600 font-medium">Out of Stock</span>
                    )}
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
