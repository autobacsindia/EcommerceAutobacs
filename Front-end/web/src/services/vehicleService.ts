import axios from 'axios';

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

const createVehicleApi = () => {
  const baseURL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:5000/api';
  return axios.create({
    baseURL: baseURL,
    timeout: 10000,
    headers: {
      'Content-Type': 'application/json',
    },
  });
};

const vehicleApi = createVehicleApi();

export const vehicleService = {
  async getAllVehicles(): Promise<Vehicle[]> {
    try {
      const response = await vehicleApi.get<VehicleApiResponse>('/vehicles');
      if (response.data.success && response.data.vehicles) {
        return response.data.vehicles.map(vehicle => ({
          ...vehicle,
          name: vehicle.make + ' ' + vehicle.model,
          image: vehicle.image?.url || '/images/vehicles/' + vehicle.slug + '.jpg'
        })) as any;
      }
      return [];
    } catch (error) {
      console.error('Error fetching vehicles:', error);
      return [];
    }
  },

  async getVehicleMakes(): Promise<string[]> {
    try {
      const response = await vehicleApi.get<VehicleApiResponse>('/vehicles/makes');
      if (response.data.success && response.data.makes) {
        return response.data.makes;
      }
      return [];
    } catch (error) {
      console.error('Error fetching vehicle makes:', error);
      return [];
    }
  },

  async getModelsByMake(make: string): Promise<string[]> {
    try {
      const response = await vehicleApi.get<VehicleApiResponse>('/vehicles/models/' + make);
      if (response.data.success && response.data.models) {
        return response.data.models;
      }
      return [];
    } catch (error) {
      console.error('Error fetching models for make ' + make + ':', error);
      return [];
    }
  },

  async getVehicleById(id: string): Promise<Vehicle | null> {
    try {
      const response = await vehicleApi.get<VehicleApiResponse>('/vehicles/' + id);
      if (response.data.success && response.data.vehicle) {
        return response.data.vehicle;
      }
      return null;
    } catch (error) {
      console.error('Error fetching vehicle with ID ' + id + ':', error);
      return null;
    }
  }
};

export type { Vehicle, VehicleApiResponse };

