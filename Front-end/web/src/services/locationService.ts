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
      willSendSessionId: !!this.sessionId
    };
    console.log('LocationService.getHeaders() debug:', JSON.stringify(debugInfo, null, 2));
    
    // Always send session ID if available
    // This ensures that if the auth token is invalid (expired/malformed),
    // the backend can still identify the user as a guest via session ID
    if (this.sessionId) {
      headers['x-session-id'] = this.sessionId;
    }
    
    console.log('LocationService headers:', JSON.stringify(headers, null, 2));
    
    return headers;
  }

  /**
   * Validate coordinate values
   */
  private isValidCoordinates(latitude: number, longitude: number): boolean {
    return (
      !isNaN(latitude) &&
      !isNaN(longitude) &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180
    );
  }

  /**
   * Select and save a delivery location
   */
  async selectLocation(data: LocationSelectRequest): Promise<LocationSelectResponse> {
    try {
      // Validate coordinates if present
      if (data.coordinates) {
        if (!this.isValidCoordinates(data.coordinates.latitude, data.coordinates.longitude)) {
          throw new Error('Invalid coordinates provided');
        }
      }
      
      const response = await apiClient.post<LocationSelectResponse>(
        `${this.baseUrl}/select`,
        data,
        { 
          headers: this.getHeaders(),
          timeout: 15000, // 15 second timeout
          retries: 2,
          retryDelay: 1000
        }
      );
      
      // Store location in local storage for quick access
      if (response.location) {
        localStorage.setItem('autobacs_current_location', JSON.stringify(response.location));
      }
      
      return response;
    } catch (error: any) {
      console.error('Select location error:', error);
      
      // Handle Network Error / Failed to fetch
      if (error.message === 'Failed to fetch' || error.message.includes('NetworkError')) {
         throw new Error('Unable to connect to location service. Please check your internet connection or try again later.');
      }
      
      // Enhanced error handling for reverse geocode failures
      if (error.message && error.message.includes('reverse geocode')) {
        // Categorize the specific type of reverse geocode error
        if (error.message.includes('zero results')) {
          throw new Error('No address found for the provided coordinates. Please try entering your location manually.');
        } else if (error.message.includes('timeout') || error.status === 408) {
          throw new Error('Geocoding service is temporarily unavailable. Please try entering your location manually or try again later.');
        } else if (error.status >= 500) {
          throw new Error('Geocoding service is currently unavailable. Please try entering your location manually.');
        } else {
          throw new Error('Failed to determine your address from location. Please try entering your location manually.');
        }
      }
      
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
        {
          params: { limit }
        }
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
        {
          params: { postalCode: data.pinCode }
        }
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
   * Check if location permission is denied
   */
  async isLocationDenied(): Promise<boolean> {
    if (!navigator.geolocation) {
      return true;
    }

    try {
      const permission = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
      return permission.state === 'denied';
    } catch (error) {
      console.error('Check location permission error:', error);
      return false;
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
          // Validate coordinates before resolving
          const { latitude, longitude } = position.coords;
          if (this.isValidCoordinates(latitude, longitude)) {
            resolve({
              latitude,
              longitude
            });
          } else {
            reject(new Error('Invalid coordinates received from device'));
          }
        },
        (error) => {
          let message = 'Unable to retrieve your location';
          
          switch (error.code) {
            case error.PERMISSION_DENIED:
              message = 'Location permission denied. Please enable location access in your browser settings.';
              break;
            case error.POSITION_UNAVAILABLE:
              message = 'Location information unavailable. Please ensure location services are enabled.';
              break;
            case error.TIMEOUT:
              message = 'Location request timed out. Please try again.';
              break;
          }
          
          if (error.code !== error.PERMISSION_DENIED) {
            console.error('Get current coordinates error:', error);
          }
          
          reject(new Error(message));
        },
        {
          enableHighAccuracy: true,
          timeout: 15000, // Increased timeout
          maximumAge: 300000 // 5 minutes
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
   * Get zone badge color with improved visual hierarchy
   * - Emerald (green) for Metro: Fastest delivery
   * - Sky (blue) for Tier-1: Fast delivery
   * - Amber (orange) for Tier-2: Standard delivery
   * - Rose (red) for Remote: Extended delivery
   */
  getZoneBadgeColor(type: string): string {
    const colors: Record<string, string> = {
      metro: 'bg-emerald-100 text-emerald-800 border border-emerald-300',
      tier1: 'bg-sky-100 text-sky-800 border border-sky-300',
      tier2: 'bg-amber-100 text-amber-900 border border-amber-300',
      remote: 'bg-rose-100 text-rose-800 border border-rose-300'
    };
    return colors[type] || colors.remote;
  }

  /**
   * Enhanced reverse geocode error recovery with multiple fallback options
   */
  async handleReverseGeocodeError(
    coordinates: { latitude: number; longitude: number },
    fallbackAction?: 'manual_entry' | 'map_picker' | 'previous_location'
  ): Promise<{ success: boolean; message?: string; location?: UserLocation }> {
    try {
      // Store coordinates as fallback if manual entry also fails
      if (coordinates) {
        localStorage.setItem('autobacs_last_coordinates', JSON.stringify(coordinates));
      }
      
      switch (fallbackAction) {
        case 'manual_entry':
          // Return indication that manual entry is needed
          return { 
            success: false, 
            message: 'Please enter your location manually.' 
          };
          
        case 'previous_location':
          // Try to retrieve and use previous location if available
          const previousLocation = this.getCachedLocation();
          if (previousLocation) {
            return { 
              success: true, 
              location: previousLocation,
              message: 'Using your previous location.'
            };
          }
          return { 
            success: false, 
            message: 'Please enter your location manually.' 
          };
          
        case 'map_picker':
        default:
          // Default to manual entry option
          return { 
            success: false, 
            message: 'Please enter your location manually.' 
          };
      }
    } catch (error) {
      console.error('Error in reverse geocode error recovery:', error);
      return { 
        success: false, 
        message: 'Failed to recover from location error. Please try again.' 
      };
    }
  }

  /**
   * Get last known coordinates from local storage
   */
  getLastKnownCoordinates(): { latitude: number; longitude: number } | null {
    try {
      const coordsStr = localStorage.getItem('autobacs_last_coordinates');
      return coordsStr ? JSON.parse(coordsStr) : null;
    } catch (error) {
      console.error('Error getting last known coordinates:', error);
      return null;
    }
  }

  /**
   * Retry reverse geocoding with exponential backoff
   */
  async retryReverseGeocode(data: LocationSelectRequest, maxRetries: number = 3): Promise<LocationSelectResponse> {
    let lastError: any;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Validate coordinates if present
        if (data.coordinates) {
          if (!this.isValidCoordinates(data.coordinates.latitude, data.coordinates.longitude)) {
            throw new Error('Invalid coordinates provided');
          }
        }
        
        const response = await apiClient.post<LocationSelectResponse>(
          `${this.baseUrl}/select`,
          data,
          { 
            headers: this.getHeaders(),
            timeout: 15000, // 15 second timeout
            retries: 0, // Disable internal retries for this specific flow
            retryDelay: 1000
          }
        );
        
        // Store location in local storage for quick access
        if (response.location) {
          localStorage.setItem('autobacs_current_location', JSON.stringify(response.location));
        }
        
        return response;
      } catch (error: any) {
        lastError = error;
        
        // Check if this is a reverse geocode error that we should retry
        const isReverseGeocodeError = error.message && error.message.includes('reverse geocode');
        
        if (isReverseGeocodeError && attempt < maxRetries - 1) {
          // Exponential backoff: 1s, 2s, 4s, etc.
          const delay = Math.pow(2, attempt) * 1000;
          console.log(`Reverse geocode attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
          
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        // If it's not a reverse geocode error or we're out of retries, break
        break;
      }
    }
    
    // If all retries failed, throw the last error
    throw lastError;
  }
}

// Export singleton instance
export const locationService = new LocationService();
export default locationService;
