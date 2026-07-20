'use client';

import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';

/** A vehicle make as consumed by the selectors. `slug` is a superset field —
 * the home menu only reads `_id`/`name`, the selectors also use `slug`. */
export interface VehicleMakeItem {
  _id: string;
  name: string;
  slug: string;
}

async function fetchVehicleMakes(): Promise<VehicleMakeItem[]> {
  const res = await apiClient.get<{ makes?: string[] }>('/vehicles/makes');
  return (res?.makes ?? []).map((make) => ({
    _id: make,
    name: make,
    slug: make.toLowerCase().replace(/\s+/g, '-'),
  }));
}

/**
 * Shared vehicle-makes query. Replaces the three separate `useCachedData`
 * consumers (home menu, header selector, vehicle selector) that each hand-rolled
 * the same fetch under the same key — now one cached query dedupes them.
 * 24h staleTime: the make list barely changes and is heavily cached at origin.
 */
export function useVehicleMakes() {
  return useQuery({
    queryKey: ['vehicles', 'makes'],
    queryFn: fetchVehicleMakes,
    staleTime: 24 * 60 * 60 * 1000,
  });
}
