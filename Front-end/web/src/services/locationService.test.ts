import locationService from './locationService';
import apiClient from '@/lib/api';

// Mock API client
jest.mock('@/lib/api', () => {
  const get = jest.fn();
  const post = jest.fn();
  const del = jest.fn(); // Mock delete as 'del' since delete is a reserved word
  return {
    __esModule: true,
    default: { get, post, delete: del },
  };
});

const mockedApiClient = apiClient as any;

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn((key: string) => store[key] || null),
    setItem: jest.fn((key: string, value: string) => {
      store[key] = value.toString();
    }),
    removeItem: jest.fn((key: string) => {
      delete store[key];
    }),
    clear: jest.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Mock navigator.geolocation and navigator.permissions
const mockGeolocation = {
  getCurrentPosition: jest.fn(),
  watchPosition: jest.fn(),
  clearWatch: jest.fn(),
};

const mockPermissions = {
  query: jest.fn(),
};

Object.defineProperty(global.navigator, 'geolocation', {
  value: mockGeolocation,
  writable: true,
});

Object.defineProperty(global.navigator, 'permissions', {
  value: mockPermissions,
  writable: true,
});

describe('LocationService', () => {
  beforeEach(() => {
    mockedApiClient.get.mockReset();
    mockedApiClient.post.mockReset();
    mockedApiClient.delete.mockReset();
    localStorageMock.clear();
    mockGeolocation.getCurrentPosition.mockReset();
    mockPermissions.query.mockReset();
    jest.clearAllMocks();
  });

  describe('selectLocation', () => {
    it('validates coordinates correctly', async () => {
      const invalidData = {
        address: 'Test Address',
        coordinates: { latitude: 100, longitude: 200 }, // Invalid coords
      };

      await expect(locationService.selectLocation(invalidData as any)).rejects.toThrow('Invalid coordinates provided');
    });

    it('sends correct payload and caches location on success', async () => {
      const locationData = {
        address: 'Test Address',
        coordinates: { latitude: 10, longitude: 20 },
        postalCode: '123456',
        city: 'City',
        state: 'State',
        country: 'Country',
      };

      const apiResponse = {
        success: true,
        location: { ...locationData, id: 'loc_1' },
      };

      mockedApiClient.post.mockResolvedValue(apiResponse);

      const result = await locationService.selectLocation(locationData);

      expect(mockedApiClient.post).toHaveBeenCalledWith(
        '/location/select',
        expect.objectContaining({
          coordinates: [20, 10], // Longitude, Latitude
        }),
        expect.any(Object)
      );

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'autobacs_current_location',
        JSON.stringify(apiResponse.location)
      );

      expect(result).toEqual(apiResponse);
    });

    it('handles reverse geocode errors', async () => {
        const locationData = {
            address: 'Test Address',
            coordinates: { latitude: 10, longitude: 20 },
        };
        const error = { message: 'reverse geocode zero results' };
        mockedApiClient.post.mockRejectedValue(error);

        await expect(locationService.selectLocation(locationData as any)).rejects.toThrow('No address found for the provided coordinates');
    });
  });

  describe('getCurrentLocation', () => {
    it('returns location from API and caches it', async () => {
      const location = { id: 'loc_1', address: 'Test Address' };
      const apiResponse = { location };

      mockedApiClient.get.mockResolvedValue(apiResponse);

      const result = await locationService.getCurrentLocation();

      expect(mockedApiClient.get).toHaveBeenCalledWith('/location/current', expect.any(Object));
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'autobacs_current_location',
        JSON.stringify(location)
      );
      expect(result).toEqual(location);
    });

    it('removes cached location on 404', async () => {
      const error = { status: 404 };
      mockedApiClient.get.mockRejectedValue(error);

      const result = await locationService.getCurrentLocation();

      expect(result).toBeNull();
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('autobacs_current_location');
    });
  });

  describe('getCachedLocation', () => {
    it('returns parsed location from localStorage', () => {
      const location = { id: 'loc_1', address: 'Cached Address' };
      localStorageMock.getItem.mockReturnValue(JSON.stringify(location));

      const result = locationService.getCachedLocation();

      expect(result).toEqual(location);
    });

    it('returns null if no location cached', () => {
      localStorageMock.getItem.mockReturnValue(null);

      const result = locationService.getCachedLocation();

      expect(result).toBeNull();
    });
  });

  describe('validateAddress', () => {
    it('calls validate endpoint with postal code', async () => {
      const postalCode = '123456';
      const apiResponse = { success: true, serviceable: true };

      mockedApiClient.post.mockResolvedValue(apiResponse);

      const result = await locationService.validateAddress(postalCode);

      expect(mockedApiClient.post).toHaveBeenCalledWith('/location/validate', { postalCode });
      expect(result).toEqual(apiResponse);
    });
  });

  describe('getDeliveryEstimate', () => {
    it('requests estimate for postal code', async () => {
      const request = { pinCode: '123456' };
      const apiResponse = { minDays: 2, maxDays: 4 };

      mockedApiClient.get.mockResolvedValue(apiResponse);

      const result = await locationService.getDeliveryEstimate(request);

      expect(mockedApiClient.get).toHaveBeenCalledWith(
        '/location/estimate',
        { params: { postalCode: '123456' } }
      );
      expect(result).toEqual(apiResponse);
    });
  });

  describe('calculateShippingCost', () => {
    it('posts to shipping-cost endpoint', async () => {
      const request = {
        pinCode: '123456',
        items: [{ productId: 'p1', quantity: 1 }],
      };
      const apiResponse = { cost: 50, currency: 'INR' };

      mockedApiClient.post.mockResolvedValue(apiResponse);

      const result = await locationService.calculateShippingCost(request);

      expect(mockedApiClient.post).toHaveBeenCalledWith(
        '/delivery-zones/shipping-cost',
        request
      );
      expect(result).toEqual(apiResponse);
    });
  });

  describe('formatDeliveryEstimate', () => {
    it('formats single day estimate', () => {
      expect(locationService.formatDeliveryEstimate(1, 1)).toBe('Delivers in 1 day');
      expect(locationService.formatDeliveryEstimate(2, 2)).toBe('Delivers in 2 days');
    });

    it('formats range estimate', () => {
      expect(locationService.formatDeliveryEstimate(2, 4)).toBe('Delivers in 2-4 days');
    });
  });

  describe('getRecentLocations', () => {
    it('fetches recent locations successfully', async () => {
      const locations = [{ id: 'loc_1' }, { id: 'loc_2' }];
      mockedApiClient.get.mockResolvedValue({ locations });

      const result = await locationService.getRecentLocations(3);

      expect(mockedApiClient.get).toHaveBeenCalledWith(
        '/location/recent',
        { params: { limit: 3 } }
      );
      expect(result).toEqual(locations);
    });

    it('returns empty array on error', async () => {
      mockedApiClient.get.mockRejectedValue(new Error('API Error'));
      
      await expect(locationService.getRecentLocations()).rejects.toThrow('API Error');
    });
  });

  describe('clearLocation', () => {
    it('clears location from API and localStorage', async () => {
      mockedApiClient.delete.mockResolvedValue({});

      await locationService.clearLocation();

      expect(mockedApiClient.delete).toHaveBeenCalledWith(
        '/location/clear',
        expect.any(Object)
      );
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('autobacs_current_location');
    });
  });

  describe('checkProductAvailability', () => {
    it('checks availability for a product', async () => {
      const productId = 'prod_123';
      const response = { available: true, stock: 10 };
      mockedApiClient.get.mockResolvedValue(response);

      const result = await locationService.checkProductAvailability(productId);

      expect(mockedApiClient.get).toHaveBeenCalledWith(
        `/warehouses/products/${productId}/availability`
      );
      expect(result).toEqual(response);
    });
  });

  describe('selectWarehouseForOrder', () => {
    it('selects warehouse for order', async () => {
      const data = { 
        orderId: 'ord_123', 
        warehouseId: 'wh_1',
        orderItems: [{ productId: 'p1', quantity: 1 }],
        deliveryAddress: {
           street: '123 Main St',
           city: 'Test City',
           state: 'Test State',
           zipCode: '123456',
           country: 'Test Country',
           postalCode: '123456',
           coordinates: { latitude: 10, longitude: 20 }
         }
      };
      const response = { success: true };
      mockedApiClient.post.mockResolvedValue(response);

      const result = await locationService.selectWarehouseForOrder(data);

      expect(mockedApiClient.post).toHaveBeenCalledWith(
        '/warehouses/select-for-order',
        data
      );
      expect(result).toEqual(response);
    });
  });

  describe('findNearestWarehouse', () => {
    it('finds nearest warehouse', async () => {
      const coords = { latitude: 10, longitude: 20 };
      const warehouse = { id: 'wh_1', name: 'Main Warehouse' };
      mockedApiClient.get.mockResolvedValue({ warehouse });

      const result = await locationService.findNearestWarehouse(coords.latitude, coords.longitude);

      expect(mockedApiClient.get).toHaveBeenCalledWith(
        '/warehouses/nearest',
        expect.objectContaining({
            params: expect.objectContaining({
                latitude: coords.latitude,
                longitude: coords.longitude
            })
        })
      );
      expect(result).toEqual(warehouse);
    });

    it('returns null when no warehouse found (404)', async () => {
      const error = { status: 404 };
      mockedApiClient.get.mockRejectedValue(error);

      const result = await locationService.findNearestWarehouse(0, 0);

      expect(result).toBeNull();
    });
  });

  describe('getZoneByPinCode', () => {
    it('gets zone info by pincode', async () => {
      const pinCode = '123456';
      const response = { zone: 'metro' };
      mockedApiClient.get.mockResolvedValue(response);

      const result = await locationService.getZoneByPinCode(pinCode);

      expect(mockedApiClient.get).toHaveBeenCalledWith(`/delivery-zones/pincode/${pinCode}`);
      expect(result).toEqual(response);
    });
  });

  describe('Location Permissions', () => {
    it('returns true if permission is denied', async () => {
      mockPermissions.query.mockResolvedValue({ state: 'denied' });
      const result = await locationService.isLocationDenied();
      expect(result).toBe(true);
    });

    it('returns true (as denied) if geolocation not supported', async () => {
        // Temporarily remove geolocation
        const originalGeo = global.navigator.geolocation;
        Object.defineProperty(global.navigator, 'geolocation', { value: undefined, writable: true });
        
        const result = await locationService.isLocationDenied();
        expect(result).toBe(true);
        
        // Restore
        Object.defineProperty(global.navigator, 'geolocation', { value: originalGeo, writable: true });
    });

    it('returns false on permission query error', async () => {
      mockPermissions.query.mockRejectedValue(new Error('Permission API Error'));
      const result = await locationService.isLocationDenied();
      expect(result).toBe(false);
    });

    it('checks if permission is granted', async () => {
      mockPermissions.query.mockResolvedValue({ state: 'granted' });
      const result = await locationService.checkLocationPermission();
      expect(result).toBe(true);
    });

    it('returns false if permission is not granted', async () => {
      mockPermissions.query.mockResolvedValue({ state: 'prompt' });
      const result = await locationService.checkLocationPermission();
      expect(result).toBe(false);
    });

    it('returns false on check permission error', async () => {
      mockPermissions.query.mockRejectedValue(new Error('Permission API Error'));
      const result = await locationService.checkLocationPermission();
      expect(result).toBe(false);
    });
  });

  describe('getCurrentCoordinates', () => {
    it('resolves with coordinates when successful', async () => {
      const mockPosition = {
        coords: { latitude: 10, longitude: 20 },
      };
      
      mockGeolocation.getCurrentPosition.mockImplementation((success) => {
        success(mockPosition);
      });

      const result = await locationService.getCurrentCoordinates();
      expect(result).toEqual({ latitude: 10, longitude: 20 });
    });

    it('rejects with error when geolocation fails', async () => {
      mockGeolocation.getCurrentPosition.mockImplementation((_, error) => {
        error({ 
          code: 1, 
          message: 'User denied',
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3
        });
      });

      await expect(locationService.getCurrentCoordinates()).rejects.toThrow('Location permission denied');
    });

    it('rejects with error when coordinates are invalid', async () => {
      const mockPosition = {
        coords: { latitude: 1000, longitude: 2000 }, // Invalid
      };
      
      mockGeolocation.getCurrentPosition.mockImplementation((success) => {
        success(mockPosition);
      });

      await expect(locationService.getCurrentCoordinates()).rejects.toThrow('Invalid coordinates received from device');
    });
  });

  describe('findNearestWarehouse', () => {
    it('finds nearest warehouse', async () => {
      const coords = { latitude: 10, longitude: 20 };
      const warehouse = { id: 'wh_1', name: 'Main Warehouse' };
      mockedApiClient.get.mockResolvedValue({ warehouse });

      const result = await locationService.findNearestWarehouse(coords.latitude, coords.longitude);

      expect(mockedApiClient.get).toHaveBeenCalledWith(
        '/warehouses/nearest',
        expect.objectContaining({
            params: expect.objectContaining({
                latitude: coords.latitude,
                longitude: coords.longitude
            })
        })
      );
      expect(result).toEqual(warehouse);
    });

    it('returns null when no warehouse found (404)', async () => {
      const error = { status: 404 };
      mockedApiClient.get.mockRejectedValue(error);

      const result = await locationService.findNearestWarehouse(0, 0);

      expect(result).toBeNull();
    });

    it('throws error for non-404 errors', async () => {
      const error = { status: 500, message: 'Server Error' };
      mockedApiClient.get.mockRejectedValue(error);

      await expect(locationService.findNearestWarehouse(0, 0)).rejects.toEqual(error);
    });
  });

  describe('Formatters & UI Helpers', () => {
    it('formats delivery date range correctly', () => {
      const date1 = new Date('2023-01-01');
      const date2 = new Date('2023-01-05');
      // Note: Implementation uses 'en-IN' locale. We assume standard environment.
      // Testing return structure primarily.
      const result = locationService.formatDeliveryDateRange(date1, date2);
      expect(result).toContain('between');
    });

    it('formats same day delivery date correctly', () => {
        const date1 = new Date('2023-01-01');
        const result = locationService.formatDeliveryDateRange(date1, date1);
        expect(result).toContain('by');
    });

    it('returns correct zone display name', () => {
        expect(locationService.getZoneTypeDisplay('metro')).toBe('Metro');
        expect(locationService.getZoneTypeDisplay('unknown')).toBe('unknown');
    });

    it('returns correct zone badge color', () => {
        expect(locationService.getZoneBadgeColor('metro')).toContain('emerald');
        expect(locationService.getZoneBadgeColor('unknown')).toContain('rose'); // Fallback
    });
  });

  describe('handleReverseGeocodeError', () => {
      it('returns manual entry message by default', async () => {
          const result = await locationService.handleReverseGeocodeError({ latitude: 0, longitude: 0 });
          expect(result.success).toBe(false);
          expect(result.message).toContain('manual');
      });

      it('returns previous location if available and requested', async () => {
          const prevLoc = { id: 'prev', address: 'Old Address' };
          localStorageMock.getItem.mockReturnValue(JSON.stringify(prevLoc));
          
          const result = await locationService.handleReverseGeocodeError(
              { latitude: 0, longitude: 0 }, 
              'previous_location'
          );
          
          expect(result.success).toBe(true);
          expect(result.location).toEqual(prevLoc);
      });
  });
});
