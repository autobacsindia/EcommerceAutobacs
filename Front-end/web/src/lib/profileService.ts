import apiClient from './api';
import { UserProfile, PaginatedOrders, PaymentMethodsData, PaginatedUserReviews } from './types';

class ProfileService {
  /**
   * Get user profile
   */
  async getProfile(): Promise<UserProfile> {
    const response = await apiClient.get<{ success: boolean; user: UserProfile }>('/profile');
    return response.user;
  }

  /**
   * Update user profile
   */
  async updateProfile(profileData: Partial<UserProfile>): Promise<UserProfile> {
    const response = await apiClient.put<{ success: boolean; message: string; user: UserProfile }>('/profile', profileData);
    return response.user;
  }

  /**
   * Get user orders with pagination
   */
  async getOrders(page: number = 1, limit: number = 10): Promise<PaginatedOrders> {
    const response = await apiClient.get<{ 
      success: boolean; 
      orders: PaginatedOrders['orders']; 
      pagination: PaginatedOrders['pagination'];
      count: number;
    }>(`/orders?page=${page}&limit=${limit}`);
    
    return {
      orders: response.orders,
      pagination: response.pagination,
      count: response.count
    };
  }

  /**
   * Get user reviews with pagination
   */
  async getMyReviews(page: number = 1, limit: number = 10): Promise<PaginatedUserReviews> {
    const response = await apiClient.get<{ 
      success: boolean; 
      reviews: PaginatedUserReviews['reviews']; 
      pagination: PaginatedUserReviews['pagination'];
      count: number;
    }>(`/reviews/user?page=${page}&limit=${limit}`);
    
    return {
      reviews: response.reviews,
      pagination: response.pagination,
      count: response.count
    };
  }

  /**
   * Get user payment methods
   */
  async getPaymentMethods(): Promise<PaymentMethodsData> {
    const response = await apiClient.get<{ 
      success: boolean; 
      paymentMethods: PaymentMethodsData['paymentMethods']; 
      count: number 
    }>('/payment-methods');
    
    return {
      paymentMethods: response.paymentMethods,
      count: response.count
    };
  }

  /**
   * Add a new payment method
   */
  async addPaymentMethod(paymentMethodData: any): Promise<any> {
    const response = await apiClient.post('/payment-methods', paymentMethodData);
    return response;
  }

  /**
   * Remove a payment method
   */
  async removePaymentMethod(id: string): Promise<any> {
    const response = await apiClient.delete(`/payment-methods/${id}`);
    return response;
  }
}

const profileService = new ProfileService();
export default profileService;