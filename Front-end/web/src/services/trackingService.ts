// Tracking Service - API calls for order tracking
import apiClient from '@/lib/api';
import { TrackingAPIResponse, CarriersAPIResponse } from '@/types/tracking';

class TrackingService {
  /**
   * Track order by tracking number (public endpoint, no auth required)
   */
  async trackByNumber(trackingNumber: string): Promise<TrackingAPIResponse> {
    try {
      const response = await apiClient.get<TrackingAPIResponse>(
        `/orders/track/${trackingNumber}`
      );
      return response;
    } catch (error: any) {
      console.error('Track by number error:', error);
      throw error;
    }
  }

  /**
   * Get list of supported carriers (public endpoint)
   */
  async getCarriers(): Promise<CarriersAPIResponse> {
    try {
      const response = await apiClient.get<CarriersAPIResponse>(
        '/orders/tracking/carriers'
      );
      return response;
    } catch (error: any) {
      console.error('Get carriers error:', error);
      throw error;
    }
  }

  /**
   * Get tracking history for authenticated user's order
   */
  async getTrackingHistory(orderId: string): Promise<TrackingAPIResponse> {
    try {
      const response = await apiClient.get<TrackingAPIResponse>(
        `/orders/${orderId}/tracking`
      );
      return response;
    } catch (error: any) {
      console.error('Get tracking history error:', error);
      throw error;
    }
  }

  /**
   * Add tracking information to order (admin only)
   */
  async addTracking(
    orderId: string,
    data: { carrierCode: string; trackingNumber?: string; notes?: string }
  ): Promise<any> {
    try {
      const response = await apiClient.post(`/orders/${orderId}/tracking`, data);
      return response;
    } catch (error: any) {
      console.error('Add tracking error:', error);
      throw error;
    }
  }

  /**
   * Add tracking event to order (admin only)
   */
  async addTrackingEvent(
    orderId: string,
    event: {
      status: string;
      location?: string;
      description?: string;
      scannedBy?: string;
      timestamp?: string;
    }
  ): Promise<any> {
    try {
      const response = await apiClient.post(
        `/orders/${orderId}/tracking/events`,
        event
      );
      return response;
    } catch (error: any) {
      console.error('Add tracking event error:', error);
      throw error;
    }
  }

  /**
   * Validate tracking number format
   */
  validateTrackingNumber(trackingNumber: string): { valid: boolean; error?: string } {
    if (!trackingNumber) {
      return { valid: false, error: 'Tracking number is required' };
    }

    const trimmed = trackingNumber.trim();
    
    if (trimmed.length < 10) {
      return { valid: false, error: 'Tracking number is too short (minimum 10 characters)' };
    }

    if (trimmed.length > 25) {
      return { valid: false, error: 'Tracking number is too long (maximum 25 characters)' };
    }

    // Allow alphanumeric characters only
    if (!/^[A-Z0-9]+$/i.test(trimmed)) {
      return { valid: false, error: 'Tracking number can only contain letters and numbers' };
    }

    return { valid: true };
  }
}

// Export singleton instance
const trackingService = new TrackingService();
export default trackingService;
