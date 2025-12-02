import apiClient from '@/lib/api';
import type {
  LocationSelectRequest,
  LocationSelectResponse,
  LocationValidateRequest,
  LocationValidateResponse,
  DeliveryEstimateRequest,
  DeliveryEstimateResponse,
  ShippingCostRequest,
  ShippingCostResponse,
  UserLocation,
  ProductAvailability,
  WarehouseSelectionRequest,
  WarehouseSelectionResponse,
  Warehouse,
} from '@/types/location';

/**
 * Location Service API Client
 * Handles all location-related API calls
 */
class LocationService {
  private baseUrl = '/location';
  private sessionId: string | null = null;

  constructor() {
    // Generate or retrieve session ID for guest users
    if (typeof window !== 'undefined') {
      this.sessionId = this.getOrCreateSessionId();
    }
  }

  /**
   * Get or create a session ID for guest users
   */
  private getOrCreateSessionId(): string {
    const storageKey = 'autobacs_session_id';
    let sessionId = localStorage.getItem(storageKey);
    
    if (!sessionId) {
      sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem(storageKey, sessionId);
    }
    
    return sessionId;
  }

  /**
   * Get headers with session ID for guest users
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    
    // DEBUG: Log session ID generation
    const debugInfo = {
      sessionId: this.sessionId,
      hasAuthToken: !!apiClient.getAuthToken(),
      willSendSessionId: !!(this.sessionId && !apiClient.getAuthToken())
    };
    console.log('LocationService.getHeaders() debug:', JSON.stringify(debugInfo, null, 2));
    
    if (this.sessionId && !apiClient.getAuthToken()) {
      headers['x-session-id'] = this.sessionId;
    }
    
    console.log('LocationService headers:', JSON.stringify(headers, null, 2));
    
    return headers;
  }

  /**
   * Select and save a delivery location
   */
  async selectLocation(data: LocationSelectRequest): Promise<LocationSelectResponse> {
    try {
      const response = await apiClient.post<LocationSelectResponse>(
        `${this.baseUrl}/select`,
        data,
        { headers: this.getHeaders() }
      );
      
      // Store location in local storage for quick access
      if (response.location) {
        localStorage.setItem('autobacs_current_location', JSON.stringify(response.location));
      }
      
      return response;
    } catch (error) {
      console.error('Select location error:', error);
      throw error;
    }
  }

  /**
   * Get current saved location
   */
  async getCurrentLocation(): Promise<UserLocation | null> {
    try {
      const response = await apiClient.get<{ location: UserLocation }>(
        `${this.baseUrl}/current`,
        { headers: this.getHeaders() }
      );
      
      if (response.location) {
        localStorage.setItem('autobacs_current_location', JSON.stringify(response.location));
        return response.location;
      }
      
      return null;
    } catch (error: any) {
      // If 404, no location is set
      if (error.status === 404) {
        localStorage.removeItem('autobacs_current_location');
        return null;
      }
      console.error('Get current location error:', error);
      throw error;
    }
  }

  /**
   * Get cached location from local storage
   */
  getCachedLocation(): UserLocation | null {
    try {
      const cached = localStorage.getItem('autobacs_current_location');
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      console.error('Get cached location error:', error);
      return null;
    }
  }

  /**
   * Validate if an address is serviceable
   */
  async validateAddress(postalCode: string): Promise<LocationValidateResponse> {
    try {
      return await apiClient.post<LocationValidateResponse>(
        `${this.baseUrl}/validate`,
        { postalCode }
      );
    } catch (error) {
      console.error('Validate address error:', error);
      throw error;
    }
  }

  /**
   * Get recent locations for authenticated user
   */
  async getRecentLocations(limit: number = 5): Promise<UserLocation[]> {
    try {
      const response = await apiClient.get<{ locations: UserLocation[] }>(
        `${this.baseUrl}/recent`,
        { params: { limit } }
      );
      return response.locations || [];
    } catch (error) {
      console.error('Get recent locations error:', error);
      throw error;
    }
  }

  /**
   * Clear saved location
   */
  async clearLocation(): Promise<void> {
    try {
      await apiClient.delete(
        `${this.baseUrl}/clear`,
        { headers: this.getHeaders() }
      );
      localStorage.removeItem('autobacs_current_location');
    } catch (error) {
      console.error('Clear location error:', error);
      throw error;
    }
  }

  /**
   * Get delivery estimate for a postal code
   */
  async getDeliveryEstimate(data: DeliveryEstimateRequest): Promise<DeliveryEstimateResponse> {
    try {
      return await apiClient.get<DeliveryEstimateResponse>(
        `${this.baseUrl}/estimate`,
        { params: { postalCode: data.pinCode } }
      );
    } catch (error) {
      console.error('Get delivery estimate error:', error);
      throw error;
    }
  }

  /**
   * Calculate shipping cost
   */
  async calculateShippingCost(data: ShippingCostRequest): Promise<ShippingCostResponse> {
    try {
      return await apiClient.post<ShippingCostResponse>(
        '/delivery-zones/shipping-cost',
        data
      );
    } catch (error) {
      console.error('Calculate shipping cost error:', error);
      throw error;
    }
  }

  /**
   * Check product availability across warehouses
   */
  async checkProductAvailability(productId: string): Promise<ProductAvailability> {
    try {
      return await apiClient.get<ProductAvailability>(
        `/warehouses/products/${productId}/availability`
      );
    } catch (error) {
      console.error('Check product availability error:', error);
      throw error;
    }
  }

  /**
   * Select warehouse for order
   */
  async selectWarehouseForOrder(data: WarehouseSelectionRequest): Promise<WarehouseSelectionResponse> {
    try {
      return await apiClient.post<WarehouseSelectionResponse>(
        '/warehouses/select-for-order',
        data
      );
    } catch (error) {
      console.error('Select warehouse for order error:', error);
      throw error;
    }
  }

  /**
   * Find nearest warehouse
   */
  async findNearestWarehouse(latitude: number, longitude: number, maxDistance?: number): Promise<Warehouse | null> {
    try {
      const response = await apiClient.get<{ warehouse: Warehouse }>(
        '/warehouses/nearest',
        {
          params: {
            latitude,
            longitude,
            maxDistance
          }
        }
      );
      return response.warehouse || null;
    } catch (error: any) {
      if (error.status === 404) {
        return null;
      }
      console.error('Find nearest warehouse error:', error);
      throw error;
    }
  }

  /**
   * Get zone by PIN code
   */
  async getZoneByPinCode(pinCode: string) {
    try {
      return await apiClient.get(`/delivery-zones/pincode/${pinCode}`);
    } catch (error) {
      console.error('Get zone by PIN code error:', error);
      throw error;
    }
  }

  /**
   * Check if location permission is granted
   */
  async checkLocationPermission(): Promise<boolean> {
    if (!navigator.geolocation) {
      return false;
    }

    try {
      const permission = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
      return permission.state === 'granted';
    } catch (error) {
      console.error('Check location permission error:', error);
      return false;
    }
  }

  /**
   * Get user's current coordinates using browser geolocation
   */
  async getCurrentCoordinates(): Promise<{ latitude: number; longitude: number } | null> {
    if (!navigator.geolocation) {
      throw new Error('Geolocation is not supported by your browser');
    }

    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          });
        },
        (error) => {
          console.error('Get current coordinates error:', error);
          reject(new Error('Unable to retrieve your location'));
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        }
      );
    });
  }

  /**
   * Format delivery estimate for display
   */
  formatDeliveryEstimate(minDays: number, maxDays: number): string {
    if (minDays === maxDays) {
      return `Delivers in ${minDays} ${minDays === 1 ? 'day' : 'days'}`;
    }
    return `Delivers in ${minDays}-${maxDays} days`;
  }

  /**
   * Format delivery date range for display
   */
  formatDeliveryDateRange(minDate: Date | string, maxDate: Date | string): string {
    const min = new Date(minDate);
    const max = new Date(maxDate);
    
    const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    const minStr = min.toLocaleDateString('en-IN', options);
    const maxStr = max.toLocaleDateString('en-IN', options);
    
    if (minStr === maxStr) {
      return `by ${minStr}`;
    }
    return `between ${minStr} and ${maxStr}`;
  }

  /**
   * Get zone type display name
   */
  getZoneTypeDisplay(type: string): string {
    const displayNames: Record<string, string> = {
      metro: 'Metro',
      tier1: 'Tier-1',
      tier2: 'Tier-2',
      remote: 'Remote'
    };
    return displayNames[type] || type;
  }

  /**
   * Get zone badge color
   */
  getZoneBadgeColor(type: string): string {
    const colors: Record<string, string> = {
      metro: 'bg-green-100 text-green-800',
      tier1: 'bg-blue-100 text-blue-800',
      tier2: 'bg-yellow-100 text-yellow-800',
      remote: 'bg-gray-100 text-gray-800'
    };
    return colors[type] || colors.remote;
  }
}

// Export singleton instance
export const locationService = new LocationService();
export default locationService;
