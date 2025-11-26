'use client';

import { useState, useEffect } from 'react';
import apiClient from '@/lib/api';

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

export default function VehicleSelector({
  onVehicleSelect
}: {
  onVehicleSelect: (make: string, model: string) => void
}) {
  const [makes, setMakes] = useState<VehicleMake[]>([]);
  const [models, setModels] = useState<VehicleModel[]>([]);
  const [selectedMake, setSelectedMake] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch vehicle makes on component mount
  useEffect(() => {
    const fetchMakes = async () => {
      try {
        setLoading(true);
        const response: any = await apiClient.get('/vehicles/makes');
        setMakes(response.makes.map((make: string) => ({
          _id: make,
          name: make,
          slug: make.toLowerCase().replace(/\s+/g, '-')
        })));
      } catch (err) {
        console.error('Failed to fetch vehicle makes:', err);
        setError('Failed to load vehicle makes');
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
        setModels(response.models.map((model: string) => ({
          _id: model,
          name: model,
          slug: model.toLowerCase().replace(/\s+/g, '-')
        })));
      } catch (err) {
        console.error('Failed to fetch vehicle models:', err);
        setError('Failed to load vehicle models');
      }
    };

    fetchModels();
  }, [selectedMake]);

  // Notify parent when both make and model are selected
  useEffect(() => {
    if (selectedMake && selectedModel) {
      onVehicleSelect(selectedMake, selectedModel);
    } else if (!selectedMake) {
      onVehicleSelect('', '');
    }
  }, [selectedMake, selectedModel, onVehicleSelect]);

  const handleMakeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const make = e.target.value;
    setSelectedMake(make);
    setSelectedModel('');
  };

  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedModel(e.target.value);
  };

  if (loading) {
    return (
      <div className="flex items-center space-x-2">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
        <span>Loading vehicles...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-red-500 text-sm">
        {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col sm:flex-row gap-4">
      <div className="flex-1">
        <label htmlFor="vehicle-make" className="block text-sm font-medium text-gray-700 mb-1">
          Vehicle Make
        </label>
        <select
          id="vehicle-make"
          value={selectedMake}
          onChange={handleMakeChange}
          className="w-full rounded-md border border-gray-300 bg-white py-2 px-3 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">Select Make</option>
          {makes.map((make) => (
            <option key={make._id} value={make.name}>
              {make.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex-1">
        <label htmlFor="vehicle-model" className="block text-sm font-medium text-gray-700 mb-1">
          Vehicle Model
        </label>
        <select
          id="vehicle-model"
          value={selectedModel}
          onChange={handleModelChange}
          disabled={!selectedMake}
          className="w-full rounded-md border border-gray-300 bg-white py-2 px-3 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
        >
          <option value="">Select Model</option>
          {models.map((model) => (
            <option key={model._id} value={model.name}>
              {model.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}