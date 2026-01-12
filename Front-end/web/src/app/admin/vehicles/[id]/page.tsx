'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { ArrowLeft, Loader2 } from 'lucide-react';
import Link from 'next/link';

interface Vehicle {
  _id: string;
  make: string;
  model: string;
  year: number;
  variant?: string;
  slug: string;
  image?: {
    url: string;
    alt?: string;
  };
  isActive: boolean;
}

export default function EditVehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const unwrappedParams = use(params);
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [formData, setFormData] = useState({
    make: '',
    model: '',
    year: new Date().getFullYear(),
    variant: '',
    slug: '',
    imageUrl: '',
    imageAlt: '',
    isActive: true
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Fetch vehicle data on mount
  useEffect(() => {
    const fetchVehicle = async () => {
      try {
        const response: any = await apiClient.get(API_ENDPOINTS.VEHICLE_DETAIL(unwrappedParams.id));
        
        if (response.success && response.vehicle) {
          const vehicleData = response.vehicle;
          setVehicle(vehicleData);
          setFormData({
            make: vehicleData.make || '',
            model: vehicleData.model || '',
            year: vehicleData.year || new Date().getFullYear(),
            variant: vehicleData.variant || '',
            slug: vehicleData.slug || '',
            imageUrl: vehicleData.image?.url || '',
            imageAlt: vehicleData.image?.alt || '',
            isActive: vehicleData.isActive !== false
          });
        } else {
          alert('Vehicle not found');
          router.push('/admin/vehicles');
        }
      } catch (err: any) {
        console.error('Error fetching vehicle:', err);
        alert(err.message || 'Failed to fetch vehicle data');
        router.push('/admin/vehicles');
      } finally {
        setInitialLoading(false);
      }
    };

    fetchVehicle();
  }, [unwrappedParams.id, router]);

  // Auto-generate slug when make, model, or year changes
  useEffect(() => {
    if (formData.make && formData.model && formData.year) {
      const generatedSlug = `${formData.make}-${formData.model}-${formData.year}`
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '');
      setFormData(prev => ({ ...prev, slug: generatedSlug }));
    }
  }, [formData.make, formData.model, formData.year]);

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.make.trim()) {
      newErrors.make = 'Make is required';
    }

    if (!formData.model.trim()) {
      newErrors.model = 'Model is required';
    }

    const currentYear = new Date().getFullYear();
    if (formData.year < 1900 || formData.year > currentYear + 2) {
      newErrors.year = `Year must be between 1900 and ${currentYear + 2}`;
    }

    if (!formData.slug.trim()) {
      newErrors.slug = 'Slug is required';
    } else if (!/^[a-z0-9-]+$/.test(formData.slug)) {
      newErrors.slug = 'Slug can only contain lowercase letters, numbers, and hyphens';
    }

    if (formData.imageUrl && !isValidUrl(formData.imageUrl)) {
      newErrors.imageUrl = 'Please enter a valid URL';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const isValidUrl = (url: string) => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setLoading(true);

    try {
      const vehicleData = {
        make: formData.make.trim(),
        model: formData.model.trim(),
        year: formData.year,
        variant: formData.variant.trim() || undefined,
        slug: formData.slug.trim(),
        image: formData.imageUrl ? {
          url: formData.imageUrl.trim(),
          alt: formData.imageAlt.trim() || `${formData.make} ${formData.model}`
        } : undefined,
        isActive: formData.isActive
      };

      await apiClient.put(API_ENDPOINTS.VEHICLE_UPDATE(unwrappedParams.id), vehicleData);
      
      alert('Vehicle updated successfully!');
      router.push('/admin/vehicles');
    } catch (err: any) {
      if (err.message.includes('duplicate') || err.message.includes('slug')) {
        setErrors({ slug: 'This slug is already in use. Please choose a different one.' });
      } else {
        alert(err.message || 'Failed to update vehicle');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
    
    // Clear error when user starts typing
    if (errors[name]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[name];
        return newErrors;
      });
    }
  };

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!vehicle) {
    return null;
  }

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <Link 
        href="/admin/vehicles" 
        className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Vehicles
      </Link>

      <h1 className="text-3xl font-bold mb-8">Edit Vehicle</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Information */}
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <h2 className="text-xl font-semibold mb-4">Basic Information</h2>

          <div>
            <label htmlFor="make" className="block text-sm font-medium text-gray-700 mb-1">
              Make <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="make"
              name="make"
              value={formData.make}
              onChange={handleChange}
              className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                errors.make ? 'border-red-500' : 'border-gray-300'
              }`}
              placeholder="e.g., Toyota"
            />
            {errors.make && <p className="text-red-500 text-sm mt-1">{errors.make}</p>}
          </div>

          <div>
            <label htmlFor="model" className="block text-sm font-medium text-gray-700 mb-1">
              Model <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="model"
              name="model"
              value={formData.model}
              onChange={handleChange}
              className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                errors.model ? 'border-red-500' : 'border-gray-300'
              }`}
              placeholder="e.g., Camry"
            />
            {errors.model && <p className="text-red-500 text-sm mt-1">{errors.model}</p>}
          </div>

          <div>
            <label htmlFor="year" className="block text-sm font-medium text-gray-700 mb-1">
              Year <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              id="year"
              name="year"
              value={formData.year}
              onChange={handleChange}
              className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                errors.year ? 'border-red-500' : 'border-gray-300'
              }`}
              min="1900"
              max={new Date().getFullYear() + 2}
            />
            {errors.year && <p className="text-red-500 text-sm mt-1">{errors.year}</p>}
          </div>

          <div>
            <label htmlFor="variant" className="block text-sm font-medium text-gray-700 mb-1">
              Variant
            </label>
            <input
              type="text"
              id="variant"
              name="variant"
              value={formData.variant}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g., Hybrid, Sport (optional)"
            />
          </div>

          <div>
            <label htmlFor="slug" className="block text-sm font-medium text-gray-700 mb-1">
              Slug <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="slug"
              name="slug"
              value={formData.slug}
              onChange={handleChange}
              className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                errors.slug ? 'border-red-500' : 'border-gray-300'
              }`}
              placeholder="Auto-generated from make, model, and year"
            />
            {errors.slug && <p className="text-red-500 text-sm mt-1">{errors.slug}</p>}
            <p className="text-gray-500 text-sm mt-1">
              Lowercase letters, numbers, and hyphens only
            </p>
          </div>
        </div>

        {/* Image */}
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <h2 className="text-xl font-semibold mb-4">Image</h2>

          <div>
            <label htmlFor="imageUrl" className="block text-sm font-medium text-gray-700 mb-1">
              Image URL
            </label>
            <input
              type="text"
              id="imageUrl"
              name="imageUrl"
              value={formData.imageUrl}
              onChange={handleChange}
              className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                errors.imageUrl ? 'border-red-500' : 'border-gray-300'
              }`}
              placeholder="https://example.com/vehicle-image.jpg"
            />
            {errors.imageUrl && <p className="text-red-500 text-sm mt-1">{errors.imageUrl}</p>}
          </div>

          <div>
            <label htmlFor="imageAlt" className="block text-sm font-medium text-gray-700 mb-1">
              Image Alt Text
            </label>
            <input
              type="text"
              id="imageAlt"
              name="imageAlt"
              value={formData.imageAlt}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={`${formData.make} ${formData.model}` || 'Image description'}
            />
          </div>

          {formData.imageUrl && isValidUrl(formData.imageUrl) && (
            <div className="mt-4">
              <p className="text-sm font-medium text-gray-700 mb-2">Preview:</p>
              <div className="border rounded-lg p-4 bg-gray-50">
                <img
                  src={formData.imageUrl}
                  alt={formData.imageAlt || 'Preview'}
                  className="max-w-xs h-auto rounded"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'none';
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Status */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Status</h2>
          
          <div className="flex items-center">
            <input
              type="checkbox"
              id="isActive"
              name="isActive"
              checked={formData.isActive}
              onChange={handleChange}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label htmlFor="isActive" className="ml-2 block text-sm text-gray-900">
              Active (vehicle will be visible on the website)
            </label>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-4">
          <button
            type="submit"
            disabled={loading}
            className="flex-1 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading ? 'Updating...' : 'Update Vehicle'}
          </button>
          <Link
            href="/admin/vehicles"
            className="px-6 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 text-center"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
