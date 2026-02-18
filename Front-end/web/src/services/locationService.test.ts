import locationService from './locationService';
import apiClient from '@/lib/api';

// Mock API client
jest.mock('@/lib/api', () => {
  const get = jest.fn();
  const post = jest.fn();
  return {
    __esModule: true,
    default: { get, post },
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

describe('LocationService', () => {
  beforeEach(() => {
    mockedApiClient.get.mockReset();
    mockedApiClient.post.mockReset();
    localStorageMock.clear();
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
        postalCode: '123456',
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
});
