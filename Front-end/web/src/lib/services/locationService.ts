/**
 * Location Service
 * Handles location selection, geocoding, and delivery estimates
 * 
 * This service abstracts the API layer from the UI.
 * UI components should use this service instead of calling apiClient directly.
 * 
 * NOTE: Location API calls Google Maps (costs money), so this service
 * implements caching to reduce API calls.
 */

import apiClient from '@/lib/api';

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface AddressComponents {
  street?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface LocationData {
  placeId?: string;
  address?: AddressComponents;
  coordinates?: Coordinates;
  street?: string;
}

export interface DeliveryEstimate {
  postalCode: string;
  deliverable: boolean;
  estimatedDays: number;
  shippingCost: number;
  message?: string;
}

export interface SelectedLocation {
  _id: string;
  placeId: string;
  formattedAddress: string;
  address: AddressComponents;
  coordinates: Coordinates;
  deliveryZone?: any;
  nearestWarehouse?: any;
  deliveryEstimate?: DeliveryEstimate;
}

// Simple in-memory cache for location data
const locationCache = new Map<string, any>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const LocationService = {
  /**
   * Select and save user location
   */
  async selectLocation(locationData: LocationData): Promise<{
    success: boolean;
    location: SelectedLocation;
    deliveryZone?: any;
    nearestWarehouse?: any;
    deliveryEstimate?: DeliveryEstimate;
  }> {
    // Clear cache when location changes
    locationCache.clear();
    
    return apiClient.post('/location/select', locationData);
  },

  /**
   * Get current user location
   */
  async getCurrentLocation(): Promise<{ success: boolean; location: SelectedLocation | null }> {
    const cacheKey = 'current_location';
    const cached = locationCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }
    
    const data = await apiClient.get<{ success: boolean; location: SelectedLocation | null }>('/location/current');
    
    // Cache the result
    locationCache.set(cacheKey, {
      data,
      timestamp: Date.now()
    });
    
    return data;
  },

  /**
   * Get delivery estimate for a postal code
   */
  async getDeliveryEstimate(postalCode: string): Promise<{
    success: boolean;
    deliverable: boolean;
    estimatedDays: number;
    shippingCost: number;
    message?: string;
  }> {
    const cacheKey = `delivery_estimate_${postalCode}`;
    const cached = locationCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }
    
    const data = await apiClient.get<{
      success: boolean;
      deliverable: boolean;
      estimatedDays: number;
      shippingCost: number;
      message?: string;
    }>(`/location/estimate?postalCode=${encodeURIComponent(postalCode)}`);
    
    // Cache the result
    locationCache.set(cacheKey, {
      data,
      timestamp: Date.now()
    });
    
    return data;
  },

  /**
   * Get recent locations (authenticated users only)
   */
  async getRecentLocations(limit: number = 5): Promise<{ success: boolean; locations: SelectedLocation[] }> {
    return apiClient.get(`/location/recent?limit=${limit}`);
  },

  /**
   * Clear saved location
   */
  async clearLocation(): Promise<{ success: boolean; message: string }> {
    // Clear cache
    locationCache.clear();
    
    return apiClient.delete('/location/clear');
  },

  /**
   * Clear the location cache (useful for testing or force refresh)
   */
  clearCache(): void {
    locationCache.clear();
  }
};

export default LocationService;
