'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { locationService } from '@/services/locationService';
import type {
  UserLocation,
  DeliveryZone,
  DeliveryEstimate,
  LocationContextType,
  LocationSelectRequest,
  LocationValidateResponse,
} from '@/types/location';

const LocationContext = createContext<LocationContextType | undefined>(undefined);

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const [currentLocation, setCurrentLocation] = useState<UserLocation | null>(null);
  const [deliveryZone, setDeliveryZone] = useState<DeliveryZone | null>(null);
  const [deliveryEstimate, setDeliveryEstimate] = useState<DeliveryEstimate | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Load location on mount
   */
  useEffect(() => {
    loadLocation();
  }, []);

  /**
   * Load current location from cache or API
   */
  const loadLocation = useCallback(async () => { try {
      setIsLoading(true);
      setError(null);

      // First, try to get from cache for instant display
      const cached = locationService.getCachedLocation();
      if (cached) {
        setCurrentLocation(cached);
        // Extract zone and estimate if available
        if (typeof cached.deliveryZone !== 'string' && cached.deliveryZone) {
          setDeliveryZone(cached.deliveryZone);
        }
      }

      // Then fetch fresh data from API
      const location = await locationService.getCurrentLocation();
      
      if (location) {
        setCurrentLocation(location);
        
        // Extract delivery zone
        if (typeof location.deliveryZone !== 'string' && location.deliveryZone) {
          setDeliveryZone(location.deliveryZone);
        } else if (location.deliveryZone && location.selectedAddress?.postalCode) {
          // Fetch zone details if only ID is present
          await refreshDeliveryInfo(location.selectedAddress.postalCode);
        }
      }
    } catch (err: any) {
      // Don't log error if it's just "no location set" (expected for first-time users)
      // Only set error state for actual errors that aren't 404s
      if (err.status !== 404) {
        console.error('Load location error:', err);
        setError(err.message || 'Failed to load location');
      }
      // If it's a 404 or network error on initial load, silently proceed with no location
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Refresh delivery information
   */
  const refreshDeliveryInfo = useCallback(async (postalCode: string) => {
    try {
      const estimate = await locationService.getDeliveryEstimate({ pinCode: postalCode });
      if (estimate.zone && estimate.estimate) {
        setDeliveryZone(estimate.zone as any);
        setDeliveryEstimate(estimate.estimate);
      }
    } catch (err) {
      console.error('Refresh delivery info error:', err);
    }
  }, []);

  /**
   * Select a new location
   */
  const selectLocation = useCallback(async (data: LocationSelectRequest) => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await locationService.selectLocation(data);
      
      setCurrentLocation(response.location);
      setDeliveryZone(response.deliveryZone);
      setDeliveryEstimate(response.deliveryEstimate);

      return response;
    } catch (err: any) {
      console.error('Select location error:', err);
      setError(err.message || 'Failed to select location');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Clear current location
   */
  const clearLocation = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      await locationService.clearLocation();
      
      setCurrentLocation(null);
      setDeliveryZone(null);
      setDeliveryEstimate(null);
    } catch (err: any) {
      console.error('Clear location error:', err);
      setError(err.message || 'Failed to clear location');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Validate an address
   */
  const validateAddress = useCallback(async (postalCode: string): Promise<LocationValidateResponse> => {
    try {
      setError(null);
      return await locationService.validateAddress(postalCode);
    } catch (err: any) {
      console.error('Validate address error:', err);
      setError(err.message || 'Failed to validate address');
      throw err;
    }
  }, []);

  /**
   * Refresh location data
   */
  const refreshLocation = useCallback(async () => {
    await loadLocation();
  }, [loadLocation]);

  const value: LocationContextType = {
    currentLocation,
    deliveryZone,
    deliveryEstimate,
    isLoading,
    error,
    selectLocation,
    clearLocation,
    validateAddress,
    refreshLocation,
  };

  return (
    <LocationContext.Provider value={value}>
      {children}
    </LocationContext.Provider>
  );
}

/**
 * Hook to use location context
 */
export function useLocation() {
  const context = useContext(LocationContext);
  if (context === undefined) {
    throw new Error('useLocation must be used within a LocationProvider');
  }
  return context;
}

/**
 * Hook to get location display text
 */
export function useLocationDisplay() {
  const { currentLocation, deliveryZone } = useLocation();

  const getLocationText = useCallback(() => {
    if (!currentLocation) {
      return 'Select your location';
    }

    const { selectedAddress } = currentLocation;
    return `${selectedAddress.city}, ${selectedAddress.postalCode}`;
  }, [currentLocation]);

  const getDeliveryText = useCallback(() => {
    if (!deliveryZone) {
      return null;
    }

    const { deliveryTime } = deliveryZone;
    if (deliveryTime.minDays === deliveryTime.maxDays) {
      return `${deliveryTime.minDays} days`;
    }
    return `${deliveryTime.minDays}-${deliveryTime.maxDays} days`;
  }, [deliveryZone]);

  return {
    locationText: getLocationText(),
    deliveryText: getDeliveryText(),
    hasLocation: !!currentLocation,
  };
}
