/**
 * Contact Service
 * Handles contact form submissions and message management
 * 
 * This service abstracts the API layer from the UI.
 * UI components should use this service instead of calling apiClient directly.
 */

import apiClient from '@/lib/api';

export interface ContactSubmission {
  name: string;
  email: string;
  subject: string;
  message: string;
}

export interface ContactMessage {
  _id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  status: 'new' | 'replied' | 'closed';
  user?: string;
  createdAt: string;
  updatedAt: string;
}

export const ContactService = {
  /**
   * Submit a contact form message
   */
  async submit(data: ContactSubmission): Promise<{ success: boolean; message: string; data: ContactMessage }> {
    return apiClient.post('/contact', data);
  },

  /**
   * Get current user's contact messages
   */
  async getMyMessages(): Promise<{ success: boolean; count: number; data: ContactMessage[] }> {
    return apiClient.get('/contact/me');
  },

  /**
   * Get all contact messages (admin only)
   */
  async getAllMessages(params?: {
    status?: string;
    page?: number;
    limit?: number;
    search?: string;
  }): Promise<{ success: boolean; count: number; data: ContactMessage[] }> {
    const queryParams = new URLSearchParams();
    
    if (params?.status) queryParams.append('status', params.status);
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.search) queryParams.append('search', params.search);
    
    const query = queryParams.toString();
    return apiClient.get(`/contact${query ? `?${query}` : ''}`);
  },

  /**
   * Get contact message statistics (admin only)
   */
  async getStats(): Promise<{ success: boolean; data: { newCount: number } }> {
    return apiClient.get('/contact/stats');
  },

  /**
   * Get single contact message (admin only)
   */
  async getMessage(id: string): Promise<{ success: boolean; data: ContactMessage }> {
    return apiClient.get(`/contact/${id}`);
  },

  /**
   * Reply to a contact message (admin only)
   */
  async reply(id: string, reply: string): Promise<{ success: boolean; data: ContactMessage }> {
    return apiClient.post(`/contact/${id}/reply`, { reply });
  },

  /**
   * Update contact message status (admin only)
   */
  async updateStatus(id: string, status: 'new' | 'replied' | 'closed'): Promise<{ success: boolean; data: ContactMessage }> {
    return apiClient.patch(`/contact/${id}/status`, { status });
  },

  /**
   * Delete a contact message (admin only)
   */
  async deleteMessage(id: string): Promise<{ success: boolean; message: string }> {
    return apiClient.delete(`/contact/${id}`);
  }
};

export default ContactService;
