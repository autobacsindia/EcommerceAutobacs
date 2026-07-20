'use client';

import { useState, useEffect, useRef } from 'react';
import apiClient from '@/lib/api';
import { VehicleSelectorSkeleton } from '@/components/skeletons/VehicleSelectorSkeleton';
import { useVehicleMakes } from '@/hooks/queries/useVehicleMakes';

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
  const [models, setModels] = useState<VehicleModel[]>([]);
  const [selectedMake, setSelectedMake] = useState('');
  const [selectedModel, setSelectedModel] = useState('');

  // Keep a stable ref to the callback so the effect below never re-fires
  // due to a parent re-render creating a new function identity.
  const onVehicleSelectRef = useRef(onVehicleSelect);
  useEffect(() => {
    onVehicleSelectRef.current = onVehicleSelect;
  });

  // Shared vehicle-makes query — deduped with HeaderVehicleSelector / the home
  // menu via the ['vehicles','makes'] TanStack Query key.
  const { data: makes, isLoading: loading, error: makesError } = useVehicleMakes();

  const error = makesError ? 'Failed to load vehicle makes' : null;

  // Fetch models when make is selected
  useEffect(() => {
    const fetchModels = async () => {
      if (!selectedMake) {
        setModels([]);
        return;
      }

      try {
        const encodedMake = encodeURIComponent(selectedMake);
        const response: any = await apiClient.get(`/vehicles/models/${encodedMake}`);
        setModels(response.models.map((model: string) => ({
          _id: model,
          name: model,
          slug: model.toLowerCase().replace(/\s+/g, '-')
        })));
      } catch (err) {
        console.error('Failed to fetch vehicle models:', err);
      }
    };

    fetchModels();
  }, [selectedMake]);

  // Notify parent when both make and model are selected
  useEffect(() => {
    if (selectedMake && selectedModel) {
      onVehicleSelectRef.current(selectedMake, selectedModel);
    } else if (!selectedMake) {
      onVehicleSelectRef.current('', '');
    }
  }, [selectedMake, selectedModel]);

  const handleMakeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const make = e.target.value;
    setSelectedMake(make);
    setSelectedModel('');
  };

  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedModel(e.target.value);
  };

  if (loading) {
    return <VehicleSelectorSkeleton />;
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
        <label htmlFor="vehicle-make" className="block text-sm font-medium text-ink/80 mb-1">
          Vehicle Make
        </label>
        <select
          id="vehicle-make"
          value={selectedMake}
          onChange={handleMakeChange}
          className="w-full rounded-md border border-hairline bg-obsidian py-2 px-3 shadow-sm focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
        >
          <option value="">Select Make</option>
          {(makes ?? []).map((make) => (
            <option key={make._id} value={make.name}>
              {make.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex-1">
        <label htmlFor="vehicle-model" className="block text-sm font-medium text-ink/80 mb-1">
          Vehicle Model
        </label>
        <select
          id="vehicle-model"
          value={selectedModel}
          onChange={handleModelChange}
          disabled={!selectedMake}
          className="w-full rounded-md border border-hairline bg-obsidian py-2 px-3 shadow-sm focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold disabled:bg-obsidian-raised"
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