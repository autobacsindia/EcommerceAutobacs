'use client';

import { useState, useEffect } from 'react';
import apiClient from '@/lib/api';
import { useRouter, useSearchParams } from 'next/navigation';

interface VehicleMake {
  _id: string;
  name: string;
  slug: string;
}

interface VehicleModel {
  _id: string;
  name: string;
  slug: string;
}

export default function VehicleFilterSidebar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [makes, setMakes] = useState<VehicleMake[]>([]);
  const [models, setModels] = useState<VehicleModel[]>([]);
  const [selectedMake, setSelectedMake] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Get current vehicle filters from URL
  const currentVehicleMake = searchParams.get('vehicleMake') || '';
  const currentVehicleModel = searchParams.get('vehicleModel') || '';

  // Fetch vehicle makes on component mount
  useEffect(() => {
    const fetchMakes = async () => {
      try {
        setLoading(true);
        const response: any = await apiClient.get('/vehicles/makes');
        const makeData = response.makes.map((make: string) => ({
          _id: make,
          name: make,
          slug: make.toLowerCase().replace(/\s+/g, '-')
        }));
        setMakes(makeData);
      } catch (err: any) {
        // Better error logging
        console.error('Failed to fetch vehicle makes:', {
          message: err.message || 'Unknown error',
          name: err.name,
          stack: err.stack,
          timestamp: new Date().toISOString()
        });
        setError('Failed to load vehicle makes. Please make sure the backend server is running on port 5000.');
      } finally {
        setLoading(false);
      }
    };

    fetchMakes();
  }, []);

  // Fetch models when make is selected
  useEffect(() => {
    const fetchModels = async () => {
      if (!selectedMake) {
        setModels([]);
        return;
      }

      try {
        const response: any = await apiClient.get(`/vehicles/models/${selectedMake}`);
        const modelData = response.models.map((model: string) => ({
          _id: model,
          name: model,
          slug: model.toLowerCase().replace(/\s+/g, '-')
        }));
        setModels(modelData);
      } catch (err: any) {
        // Better error logging
        console.error('Failed to fetch vehicle models:', {
          message: err.message || 'Unknown error',
          name: err.name,
          stack: err.stack,
          timestamp: new Date().toISOString()
        });
        setError('Failed to load vehicle models. Please make sure the backend server is running on port 5000.');
      }
    };

    fetchModels();
  }, [selectedMake]);

  // Initialize selected values from URL params
  useEffect(() => {
    setSelectedMake(currentVehicleMake);
    setSelectedModel(currentVehicleModel);
  }, [currentVehicleMake, currentVehicleModel]);

  const handleMakeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const make = e.target.value;
    setSelectedMake(make);
    setSelectedModel('');

    // Update URL with new vehicle make filter
    const currentParams = new URLSearchParams(searchParams.toString());
    if (make) {
      currentParams.set('vehicleMake', make);
      currentParams.delete('page'); // Reset to first page
    } else {
      currentParams.delete('vehicleMake');
      currentParams.delete('vehicleModel');
    }

    router.push(`/products?${currentParams.toString()}`);
  };

  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const model = e.target.value;
    setSelectedModel(model);

    // Update URL with new vehicle model filter
    const currentParams = new URLSearchParams(searchParams.toString());
    if (model) {
      currentParams.set('vehicleModel', model);
      currentParams.delete('page'); // Reset to first page
    } else {
      currentParams.delete('vehicleModel');
    }

    router.push(`/products?${currentParams.toString()}`);
  };

  const clearVehicleFilters = () => {
    setSelectedMake('');
    setSelectedModel('');

    // Remove vehicle filters from URL
    const currentParams = new URLSearchParams(searchParams.toString());
    currentParams.delete('vehicleMake');
    currentParams.delete('vehicleModel');
    currentParams.delete('page'); // Reset to first page

    router.push(`/products?${currentParams.toString()}`);
  };

  if (loading) {
    return (
      <div className="bg-obsidian rounded-lg shadow-md p-4">
        <h3 className="font-semibold text-ink mb-4">Filter by Vehicle</h3>
        <div className="flex items-center space-x-2">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gold"></div>
          <span>Loading vehicles...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-obsidian rounded-lg shadow-md p-4">
        <h3 className="font-semibold text-ink mb-4">Filter by Vehicle</h3>
        <div className="text-red-500 text-sm">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-obsidian rounded-lg shadow-md p-4">
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-semibold text-ink">Filter by Vehicle</h3>
        {(currentVehicleMake || currentVehicleModel) && (
          <button
            onClick={clearVehicleFilters}
            className="text-sm text-gold hover:text-gold"
          >
            Clear
          </button>
        )}
      </div>

      <div className="space-y-4">
        <div>
          <label htmlFor="sidebar-vehicle-make" className="block text-sm font-medium text-ink/80 mb-1">
            Make
          </label>
          <select
            id="sidebar-vehicle-make"
            value={selectedMake}
            onChange={handleMakeChange}
            className="w-full rounded-md border border-hairline bg-obsidian py-2 px-3 shadow-sm focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
          >
            <option value="">All Makes</option>
            {makes.map((make) => (
              <option key={make._id} value={make.name}>
                {make.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="sidebar-vehicle-model" className="block text-sm font-medium text-ink/80 mb-1">
            Model
          </label>
          <select
            id="sidebar-vehicle-model"
            value={selectedModel}
            onChange={handleModelChange}
            disabled={!selectedMake && !currentVehicleMake}
            className="w-full rounded-md border border-hairline bg-obsidian py-2 px-3 shadow-sm focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold disabled:bg-obsidian-raised"
          >
            <option value="">All Models</option>
            {models.map((model) => (
              <option key={model._id} value={model.name}>
                {model.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {(currentVehicleMake || currentVehicleModel) && (
        <div className="mt-4 pt-4 border-t border-hairline">
          <h4 className="text-sm font-medium text-ink mb-2">Active Filters</h4>
          <div className="flex flex-wrap gap-2">
            {currentVehicleMake && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gold/10 text-gold">
                {currentVehicleMake}
                <button
                  type="button"
                  className="flex-shrink-0 ml-1.5 h-4 w-4 rounded-full inline-flex items-center justify-center text-gold hover:bg-gold/10 hover:text-gold focus:outline-none"
                  onClick={() => {
                    const currentParams = new URLSearchParams(searchParams.toString());
                    currentParams.delete('vehicleMake');
                    currentParams.delete('page');
                    router.push(`/products?${currentParams.toString()}`);
                  }}
                >
                  <span className="sr-only">Remove filter</span>
                  <svg className="h-2 w-2" stroke="currentColor" fill="none" viewBox="0 0 8 8">
                    <path strokeLinecap="round" strokeWidth="1.5" d="M1 1l6 6m0-6L1 7" />
                  </svg>
                </button>
              </span>
            )}
            {currentVehicleModel && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gold/10 text-gold">
                {currentVehicleModel}
                <button
                  type="button"
                  className="flex-shrink-0 ml-1.5 h-4 w-4 rounded-full inline-flex items-center justify-center text-gold hover:bg-gold/10 hover:text-gold focus:outline-none"
                  onClick={() => {
                    const currentParams = new URLSearchParams(searchParams.toString());
                    currentParams.delete('vehicleModel');
                    currentParams.delete('page');
                    router.push(`/products?${currentParams.toString()}`);
                  }}
                >
                  <span className="sr-only">Remove filter</span>
                  <svg className="h-2 w-2" stroke="currentColor" fill="none" viewBox="0 0 8 8">
                    <path strokeLinecap="round" strokeWidth="1.5" d="M1 1l6 6m0-6L1 7" />
                  </svg>
                </button>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}