interface Vehicle {
  _id: string;
  make: string;
  model: string;
  year: number;
  variant?: string;
  slug: string;
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

import apiClient from '@/lib/api';

// Use the main API client instead of creating a separate axios instance
const vehicleApi = apiClient;

// Map vehicle slugs to local image filenames
function getVehicleImageUrl(slug: string): string {
  const vehicleImageMap: Record<string, string> = {
    'toyota-hilux': '/images/vehicles/Nova-Hilux-2021_1-scaled-1.jpg',
    'mahindra-thar': '/images/vehicles/mahindra_thar_roxx_2024_5k-3840x2160-1-scaled.jpg',
    'isuzu-dmax-v-cross': '/images/vehicles/1778470-1920x1300-desktop-hd-isuzu-wallpaper-photo.jpg',
    'maruti-jimny': '/images/vehicles/suzuki_jimny_2018_08.jpg',
    'jeep-wrangler': '/images/vehicles/181709-3000x1688-desktop-hd-jeep-background-photo-scaled.jpg',
    'toyota-fortuner': '/images/vehicles/toyota-fortuner-right-front-three-quarter0.jpg',
    'volkswagen-polo': '/images/vehicles/VW-Polo-7.jpg',
    'hyundai': '/images/vehicles/Hyundai-i20-2-jpeg.jpg',
    'kia': '/images/vehicles/Carens_1920x1080_3.jpg',
    'ford-endeavour': '/images/vehicles/Untitled-design-2024-01-04T133626.142.jpg',
    'audi': '/images/vehicles/A240553_web_2880-scaled.jpg',
    'bmw': '/images/vehicles/bmw-3-series.jpg',
    'ford-ranger': '/images/vehicles/Ford-Ranger.jpg', // This might not exist locally
    'land-rover-defender': '/images/vehicles/land-rover-defender-1333693509.jpg',
    'mercedes-benz': '/images/vehicles/Mercedes-Benz-E-Class.jpg',
  };
  
  return vehicleImageMap[slug] || `/images/vehicles/${slug}.jpg`;
}

export const vehicleService = {
  async getAllVehicles(): Promise<Vehicle[]> {
    try {
      const response = await vehicleApi.get('/vehicles') as VehicleApiResponse;
      if (response.success && response.vehicles) {
        return response.vehicles.map(vehicle => ({
          ...vehicle,
          name: vehicle.make + ' ' + vehicle.model,
          image: vehicle.image || { 
            url: getVehicleImageUrl(vehicle.slug), 
            alt: vehicle.make + ' ' + vehicle.model 
          }
        }));
      }
      return [];
    } catch (error) {
      console.error('Error fetching vehicles:', error);
      return [];
    }
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
        return response.vehicle;
      }
      return null;
    } catch (error) {
      console.error('Error fetching vehicle with ID ' + id + ':', error);
      return null;
    }
  }
};

export type { Vehicle, VehicleApiResponse };

