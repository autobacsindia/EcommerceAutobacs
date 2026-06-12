import apiClient from '@/lib/api';

interface Vehicle {
  _id: string;
  make: string;
  model: string;
  year: number;
  variant?: string;
  slug: string;
  name: string;  // Added to match service implementation
  image?: {
    url: string;
    alt: string;
  };
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface VehicleApiResponse {
  success: boolean;
  count?: number;
  vehicles?: Vehicle[];
  makes?: string[];
  models?: string[];
  vehicle?: Vehicle;
  message?: string;
}

// Use the main API client instead of creating a separate axios instance
const vehicleApi = apiClient;

export const VEHICLE_IMAGE_MAP: Record<string, string> = {
  'toyota-hilux': '/images/vehicles/Nova-Hilux-2021_1-scaled-1.jpg',
  'mahindra-thar': '/images/vehicles/mahindra_thar_roxx_2024_5k-3840x2160-1-scaled.jpg',
  'isuzu-dmax-v-cross': '/images/vehicles/1778470-1920x1300-desktop-hd-isuzu-wallpaper-photo.jpg',
  'maruti-jimny': '/images/vehicles/suzuki_jimny_2018_08.jpg',
  'jeep-wrangler': '/images/vehicles/181709-3000x1688-desktop-hd-jeep-background-photo-scaled.jpg',
  'toyota-fortuner': '/images/vehicles/toyota-fortuner-right-front-three-quarter0.jpeg',
  'volkswagen-polo': '/images/vehicles/VW-Polo-7.jpg',
  'hyundai': '/images/vehicles/Hyundai-i20-2-jpeg.jpg',
  'kia': '/images/vehicles/Carens_1920x1080_3.jpg',
  'ford-endeavour': '/images/vehicles/Untitled-design-2024-01-04T133626.142.png',
  'audi': '/images/vehicles/A240553_web_2880-scaled.jpg',
  'bmw': '/images/vehicles/bmw-3-series.jpg',
  'ford-ranger': '/images/vehicles/Untitled-design-2024-01-04T133626.142.png', // TEMP: Using Endeavour image until Ranger image is added
  'land-rover-defender': '/images/vehicles/land-rover-defender-1333693509.jpg',
  'mercedes-benz': '/images/vehicles/Mercedes-Benz-E-Class.jpg',

  'hilux': '/images/vehicles/Nova-Hilux-2021_1-scaled-1.jpg',
  'fortuner': '/images/vehicles/toyota-fortuner-right-front-three-quarter0.jpeg',
  'thar': '/images/vehicles/mahindra_thar_roxx_2024_5k-3840x2160-1-scaled.jpg',
  'jimny': '/images/vehicles/suzuki_jimny_2018_08.jpg',
  
  // Aliases for robustness
  'isuzu-dmax': '/images/vehicles/1778470-1920x1300-desktop-hd-isuzu-wallpaper-photo.jpg',
  'ranger': '/images/vehicles/Untitled-design-2024-01-04T133626.142.png', // TEMP: Using Endeavour image until Ranger image is added
  'endeavour': '/images/vehicles/Untitled-design-2024-01-04T133626.142.png',
  'wrangler': '/images/vehicles/181709-3000x1688-desktop-hd-jeep-background-photo-scaled.jpg',
  'defender': '/images/vehicles/land-rover-defender-1333693509.jpg',
  'mercedes': '/images/vehicles/Mercedes-Benz-E-Class.jpg',
};

export const CROSS_RELATED_SLUG_MAP: Record<string, string[]> = {
  // Thar <-> Jimny/Wrangler
  'mahindra-thar': ['maruti-jimny', 'jimny', 'jeep-wrangler', 'wrangler'],
  'thar': ['maruti-jimny', 'jimny', 'jeep-wrangler', 'wrangler'],
  'maruti-jimny': ['mahindra-thar', 'thar', 'jeep-wrangler', 'wrangler'],
  'jimny': ['mahindra-thar', 'thar', 'jeep-wrangler', 'wrangler'],
  
  // Isuzu <-> Ranger/Hilux
  'isuzu-dmax-v-cross': ['ford-ranger', 'ranger', 'toyota-hilux', 'hilux'],
  'isuzu-dmax': ['ford-ranger', 'ranger', 'toyota-hilux', 'hilux'],
  'ford-ranger': ['isuzu-dmax-v-cross', 'isuzu-dmax', 'ford-endeavour', 'endeavour'],
  'ranger': ['isuzu-dmax-v-cross', 'isuzu-dmax', 'ford-endeavour', 'endeavour'],
  
  // Fortuner <-> Endeavour/Hilux
  'toyota-fortuner': ['ford-endeavour', 'endeavour', 'toyota-hilux', 'hilux'],
  'fortuner': ['ford-endeavour', 'endeavour', 'toyota-hilux', 'hilux'],
  'ford-endeavour': ['toyota-fortuner', 'fortuner', 'ford-ranger', 'ranger'],
  'endeavour': ['toyota-fortuner', 'fortuner', 'ford-ranger', 'ranger'],
  'toyota-hilux': ['toyota-fortuner', 'fortuner', 'isuzu-dmax-v-cross', 'isuzu-dmax'],
  'hilux': ['toyota-fortuner', 'fortuner', 'isuzu-dmax-v-cross', 'isuzu-dmax'],
  
  // Defender <-> Mercedes
  'land-rover-defender': ['mercedes-benz', 'mercedes'],
  'defender': ['mercedes-benz', 'mercedes'],
  'mercedes-benz': ['land-rover-defender', 'defender'],
  'mercedes': ['land-rover-defender', 'defender'],
  
  // Hyundai <-> Kia
  'hyundai': ['kia'],
  'kia': ['hyundai'],
};

function getVehicleImageUrl(slug: string): string {
  return VEHICLE_IMAGE_MAP[slug] || `/images/vehicles/${slug}.jpg`;
}

export const vehicleService = {
  async getAllVehicles(): Promise<Vehicle[]> {
    // First try to get vehicles from the local API
    try {
      const response = await vehicleApi.get('/vehicles') as VehicleApiResponse;
      if (response.success && response.vehicles) {
        return response.vehicles.map(vehicle => {
          // Use the API-provided image if available, otherwise use mapping function
          const imageUrl = vehicle.image?.url || getVehicleImageUrl(vehicle.slug);
          const imageAlt = vehicle.image?.alt || (vehicle.make + ' ' + vehicle.model);
          
          return {
            ...vehicle,
            name: vehicle.make + ' ' + vehicle.model,
            image: {
              url: imageUrl,
              alt: imageAlt
            }
          };
        });
      }
    } catch (error) {
      console.error('Error fetching vehicles from local API:', error);
    }

    return [];
  },

  async getVehicleMakes(): Promise<string[]> {
    try {
      const response = await vehicleApi.get('/vehicles/makes') as VehicleApiResponse;
      if (response.success && response.makes) {
        return response.makes;
      }
      return [];
    } catch (error) {
      console.error('Error fetching vehicle makes:', error);
      return [];
    }
  },

  async getModelsByMake(make: string): Promise<string[]> {
    try {
      const response = await vehicleApi.get('/vehicles/models/' + make) as VehicleApiResponse;
      if (response.success && response.models) {
        return response.models;
      }
      return [];
    } catch (error) {
      console.error('Error fetching models for make ' + make + ':', error);
      return [];
    }
  },

  async getVehicleById(id: string): Promise<Vehicle | null> {
    try {
      const response = await vehicleApi.get('/vehicles/' + id) as VehicleApiResponse;
      if (response.success && response.vehicle) {
        const vehicle = response.vehicle;
        // Ensure the vehicle has the name and proper image structure
        const imageUrl = vehicle.image?.url || getVehicleImageUrl(vehicle.slug);
        const imageAlt = vehicle.image?.alt || (vehicle.make + ' ' + vehicle.model);
        
        return {
          ...vehicle,
          name: vehicle.make + ' ' + vehicle.model,
          image: {
            url: imageUrl,
            alt: imageAlt
          }
        };
      }
      return null;
    } catch (error) {
      console.error('Error fetching vehicle with ID ' + id + ':', error);
      console.error('Failed to fetch vehicle from API');
      return null;
    }
  },

  /**
   * Get products compatible with a specific vehicle
   * @param vehicleId - Vehicle ID or slug
   * @param options - Query options (page, limit, filters)
   */
  async getVehicleProducts(vehicleId: string, options: {
    page?: number;
    limit?: number;
    category?: string;
    brand?: string;
    minPrice?: number;
    maxPrice?: number;
    sortBy?: string;
    order?: 'asc' | 'desc';
    inStock?: boolean;
  } = {}, requestOptions?: { timeout?: number }): Promise<any> {
    try {
      const params = new URLSearchParams();
      
      if (options.page) params.append('page', options.page.toString());
      if (options.limit) params.append('limit', options.limit.toString());
      if (options.category) params.append('category', options.category);
      if (options.brand) params.append('brand', options.brand);
      if (options.minPrice) params.append('minPrice', options.minPrice.toString());
      if (options.maxPrice) params.append('maxPrice', options.maxPrice.toString());
      if (options.sortBy) params.append('sortBy', options.sortBy);
      if (options.order) params.append('order', options.order);
      if (options.inStock !== undefined) params.append('inStock', options.inStock.toString());
      
      const queryString = params.toString();
      const url = `/products/by-vehicle/${vehicleId}${queryString ? '?' + queryString : ''}`;
      
      const response = await vehicleApi.get(url, requestOptions);
      return response;
    } catch (error) {
      // Don't log error here - let the calling code decide how to handle it
      // This prevents duplicate error logging when fallback succeeds
      throw error;
    }
  }
};

export type { Vehicle, VehicleApiResponse };
