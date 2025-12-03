/**
 * Location History Utilities
 * Manages storage and retrieval of user's recent location selections
 */

import { UserLocation } from '@/types/location';

const STORAGE_KEY = 'autobacs_location_history';
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
export function getLocationHistory(): LocationHistoryItem[] {
  try {
    if (typeof window === 'undefined') {
      return [];
    }

    const stored = localStorage.getItem(STORAGE_KEY);
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
    let history = getLocationHistory();

    // Remove existing entry with same postal code
    history = history.filter(
      (item) => item.address.postalCode !== location.selectedAddress.postalCode
    );

    // Add new item at the beginning
    history.unshift(historyItem);

    // Keep only max items
    history = history.slice(0, MAX_HISTORY_ITEMS);

    // Save to localStorage
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch (error) {
    console.error('Error saving to location history:', error);
  }
}

/**
 * Clear all location history
 */
export function clearLocationHistory(): void {
  try {
    if (typeof window === 'undefined') {
      return;
    }

    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error('Error clearing location history:', error);
  }
}

/**
 * Remove specific item from history
 */
export function removeFromHistory(itemId: string): void {
  try {
    if (typeof window === 'undefined') {
      return;
    }

    let history = getLocationHistory();
    history = history.filter((item) => item.id !== itemId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch (error) {
    console.error('Error removing from location history:', error);
  }
}

/**
 * Mark current location in history
 */
export function markCurrentLocation(postalCode: string): LocationHistoryItem[] {
  const history = getLocationHistory();
  return history.map((item) => ({
    ...item,
    isCurrent: item.address.postalCode === postalCode,
  }));
}
