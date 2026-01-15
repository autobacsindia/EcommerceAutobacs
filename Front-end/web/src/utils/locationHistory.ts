/**
 * Location History Utilities
 * Manages storage and retrieval of user's recent location selections
 */

import { UserLocation } from '@/types/location';

const BASE_STORAGE_KEY = 'autobacs_location_history';
const MAX_HISTORY_ITEMS = 5;

export interface LocationHistoryItem {
  id: string;
  address: {
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  deliveryZone?: {
    type: string;
    name: string;
  };
  timestamp: string;
  isCurrent?: boolean;
}

function getStorageKey(ownerId?: string | null): string {
  if (!ownerId) return `${BASE_STORAGE_KEY}_guest`;
  return `${BASE_STORAGE_KEY}_${ownerId}`;
}

/**
 * Convert UserLocation to LocationHistoryItem
 */
export function createHistoryItem(location: UserLocation): LocationHistoryItem {
  const item: LocationHistoryItem = {
    id: `${location.selectedAddress.postalCode}_${Date.now()}`,
    address: {
      city: location.selectedAddress.city,
      state: location.selectedAddress.state,
      postalCode: location.selectedAddress.postalCode,
      country: location.selectedAddress.country,
    },
    timestamp: new Date().toISOString(),
  };

  // Add delivery zone if available
  if (location.deliveryZone && typeof location.deliveryZone !== 'string') {
    item.deliveryZone = {
      type: location.deliveryZone.type,
      name: location.deliveryZone.name,
    };
  }

  return item;
}

/**
 * Get location history from localStorage
 * Returns empty array if no history or on error
 */
export function getLocationHistory(ownerId?: string | null): LocationHistoryItem[] {
  try {
    if (typeof window === 'undefined') {
      return [];
    }

    const stored = localStorage.getItem(getStorageKey(ownerId));
    if (!stored) {
      return [];
    }

    const history = JSON.parse(stored);
    if (!Array.isArray(history)) {
      return [];
    }

    // Validate and return
    return history.filter((item): item is LocationHistoryItem => {
      return (
        item &&
        typeof item === 'object' &&
        item.address &&
        item.address.postalCode &&
        item.timestamp
      );
    });
  } catch (error) {
    console.error('Error reading location history:', error);
    return [];
  }
}

/**
 * Add location to history
 * Deduplicates by postal code and maintains max limit
 */
export function addToLocationHistory(location: UserLocation): void {
  try {
    if (typeof window === 'undefined') {
      return;
    }

    const historyItem = createHistoryItem(location);
    const ownerId = (location.user as string) || location.sessionId || null;
    let history = getLocationHistory(ownerId);

    // Remove existing entry with same postal code
    history = history.filter(
      (item) => item.address.postalCode !== location.selectedAddress.postalCode
    );

    // Add new item at the beginning
    history.unshift(historyItem);

    // Keep only max items
    history = history.slice(0, MAX_HISTORY_ITEMS);

    // Save to localStorage
    localStorage.setItem(getStorageKey(ownerId), JSON.stringify(history));
  } catch (error) {
    console.error('Error saving to location history:', error);
  }
}

/**
 * Clear all location history
 */
export function clearLocationHistory(ownerId?: string | null): void {
  try {
    if (typeof window === 'undefined') {
      return;
    }

    localStorage.removeItem(getStorageKey(ownerId));
  } catch (error) {
    console.error('Error clearing location history:', error);
  }
}

/**
 * Remove specific item from history
 */
export function removeFromHistory(itemId: string, ownerId?: string | null): void {
  try {
    if (typeof window === 'undefined') {
      return;
    }

    let history = getLocationHistory(ownerId);
    history = history.filter((item) => item.id !== itemId);
    localStorage.setItem(getStorageKey(ownerId), JSON.stringify(history));
  } catch (error) {
    console.error('Error removing from location history:', error);
  }
}

/**
 * Mark current location in history
 */
export function markCurrentLocation(postalCode: string, ownerId?: string | null): LocationHistoryItem[] {
  const history = getLocationHistory(ownerId);
  return history.map((item) => ({
    ...item,
    isCurrent: item.address.postalCode === postalCode,
  }));
}
