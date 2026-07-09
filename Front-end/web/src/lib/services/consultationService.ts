/**
 * Consultation Service
 * Handles consultation booking requests
 * 
 * This service abstracts the API layer from the UI.
 * UI components should use this service instead of calling apiClient directly.
 */

import apiClient from '@/lib/api';

export interface ConsultationSubmission {
  name: string;
  whatsapp: string;
  email: string;
  city: string;
  vehicleNumber?: string;
  makeModel: string;
  upgrades?: string[];
  usage?: string;
  drivingStyle?: string;
  mode?: 'In-Person' | 'Video Call' | 'Phone Call';
  preferredDate?: string;
  preferredTime?: string;
  notes?: string;
}

export interface Consultation {
  _id: string;
  name: string;
  whatsapp: string;
  email: string;
  city: string;
  vehicleNumber: string;
  makeModel: string;
  upgrades: string[];
  usage: string;
  drivingStyle: string;
  mode: string;
  preferredDate: string | null;
  preferredTime: string;
  notes: string;
  status: 'new' | 'contacted' | 'completed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
}

export const ConsultationService = {
  /**
   * Submit a consultation booking request
   */
  async book(data: ConsultationSubmission): Promise<{ success: boolean; data: Consultation }> {
    return apiClient.post('/consultation', data);
  },

  /**
   * Get all consultations (admin only)
   */
  async getAll(params?: {
    status?: 'new' | 'contacted' | 'completed' | 'cancelled';
    page?: number;
    limit?: number;
    search?: string;
  }): Promise<{
    success: boolean;
    data: Consultation[];
    total: number;
    counts: {
      new: number;
      contacted: number;
      completed: number;
      cancelled: number;
    };
  }> {
    const queryParams = new URLSearchParams();
    
    if (params?.status) queryParams.append('status', params.status);
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.search) queryParams.append('search', params.search);
    
    const query = queryParams.toString();
    return apiClient.get(`/consultation/admin${query ? `?${query}` : ''}`);
  },

  /**
   * Get single consultation (admin only)
   */
  async getConsultation(id: string): Promise<{ success: boolean; data: Consultation }> {
    return apiClient.get(`/consultation/admin/${id}`);
  },

  /**
   * Update consultation status (admin only)
   */
  async updateStatus(id: string, status: 'new' | 'contacted' | 'completed' | 'cancelled'): Promise<{ success: boolean; data: Consultation }> {
    return apiClient.patch(`/consultation/admin/${id}/status`, { status });
  },

  /**
   * Add admin notes to consultation (admin only)
   */
  async addNotes(id: string, notes: string): Promise<{ success: boolean; data: Consultation }> {
    return apiClient.patch(`/consultation/admin/${id}/notes`, { notes });
  },

  /**
   * Delete a consultation (admin only)
   */
  async deleteConsultation(id: string): Promise<{ success: boolean; message: string }> {
    return apiClient.delete(`/consultation/admin/${id}`);
  }
};

export default ConsultationService;
