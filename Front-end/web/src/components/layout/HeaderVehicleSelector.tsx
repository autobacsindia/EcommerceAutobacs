'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import apiClient from '@/lib/api';
import { Car } from 'lucide-react';

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

export default function HeaderVehicleSelector() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [makes, setMakes] = useState<VehicleMake[]>([]);
  const [models, setModels] = useState<VehicleModel[]>([]);
  const [selectedMake, setSelectedMake] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch vehicle makes on component mount
  useEffect(() => {
    const fetchMakes = async () => {
      try {
        const response: any = await apiClient.get('/vehicles/makes');
        setMakes(response.makes.map((make: string) => ({
          _id: make,
          name: make,
          slug: make.toLowerCase().replace(/\s+/g, '-')
        })));
      } catch (err) {
        console.error('Failed to fetch vehicle makes:', err);
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
        setLoading(true);
        const encodedMake = encodeURIComponent(selectedMake);
        const response: any = await apiClient.get(`/vehicles/models/${encodedMake}`);
        setModels(response.models.map((model: string) => ({
          _id: model,
          name: model,
          slug: model.toLowerCase().replace(/\s+/g, '-')
        })));
      } catch (err) {
        console.error('Failed to fetch vehicle models:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchModels();
  }, [selectedMake]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleMakeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const make = e.target.value;
    setSelectedMake(make);
    setSelectedModel('');
  };

  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedModel(e.target.value);
  };

  const handleBrowseParts = () => {
    if (selectedMake && selectedModel) {
      const makeSlug = selectedMake.toLowerCase().replace(/\s+/g, '-');
      const modelSlug = selectedModel.toLowerCase().replace(/\s+/g, '-');
      const vehicleSlug = `${makeSlug}-${modelSlug}`;
      setIsOpen(false);
      // Navigate to /model/[slug] which already works in production
      router.push(`/model/${vehicleSlug}`);
    }
  };

  const handleViewAllVehicles = () => {
    setIsOpen(false);
    router.push('/vehicles');
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Vehicle Selector Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="text-sm font-medium transition-colors relative py-1 whitespace-nowrap text-white hover:text-green-200 flex items-center gap-1"
      >
        <Car className="h-4 w-4" />
        <span>Vehicle</span>
        <span className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}>▼</span>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-80 bg-white rounded-lg shadow-xl border border-gray-200 z-50 p-4">
          <div className="space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between pb-2 border-b border-gray-200">
              <h3 className="font-semibold text-gray-900">Select Your Vehicle</h3>
              <button
                onClick={() => setIsOpen(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            {/* Make Selector */}
            <div>
              <label htmlFor="header-vehicle-make" className="block text-xs font-medium text-gray-700 mb-1">
                Vehicle Make
              </label>
              <select
                id="header-vehicle-make"
                value={selectedMake}
                onChange={handleMakeChange}
                className="w-full rounded-md border border-gray-300 bg-white py-2 px-3 text-sm shadow-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
              >
                <option value="">Select Make</option>
                {makes.map((make) => (
                  <option key={make._id} value={make.name}>
                    {make.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Model Selector */}
            <div>
              <label htmlFor="header-vehicle-model" className="block text-xs font-medium text-gray-700 mb-1">
                Vehicle Model
              </label>
              <select
                id="header-vehicle-model"
                value={selectedModel}
                onChange={handleModelChange}
                disabled={!selectedMake || loading}
                className="w-full rounded-md border border-gray-300 bg-white py-2 px-3 text-sm shadow-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
              >
                <option value="">
                  {!selectedMake ? 'Select Make First' : loading ? 'Loading...' : 'Select Model'}
                </option>
                {models.map((model) => (
                  <option key={model._id} value={model.name}>
                    {model.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Browse Button */}
            <button
              onClick={handleBrowseParts}
              disabled={!selectedMake || !selectedModel}
              className="w-full bg-green-600 text-white py-2 px-4 rounded-md text-sm font-medium hover:bg-green-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              Browse {selectedModel || 'Parts'}
            </button>

            {/* View All Vehicles Link */}
            <button
              onClick={handleViewAllVehicles}
              className="w-full text-center text-sm text-green-600 hover:text-green-700 font-medium py-1"
            >
              View All Vehicles →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
