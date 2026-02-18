import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { Order, PaginatedOrders } from '@/lib/types';

export interface CreateOrderData {
  shippingAddress: {
    fullName: string;
    addressLine1: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
    phone: string;
  };
  paymentMethod: string;
  items: Array<{
    product: string;
    quantity: number;
    price: number;
  }>;
  subtotal: number;
  tax: number;
  shippingCost: number;
  discount: number;
  totalAmount: number;
}

class OrderService {
  /**
   * Create a new order
   */
  async createOrder(orderData: CreateOrderData): Promise<{ success: boolean; order: Order }> {
    const response = await apiClient.post<{ success: boolean; order: Order }>(
      API_ENDPOINTS.ORDERS,
      orderData
    );
    return response;
  }

  /**
   * Get order by ID
   */
  async getOrderById(orderId: string): Promise<Order> {
    const response = await apiClient.get<{ success: boolean; order: Order }>(
      `${API_ENDPOINTS.ORDERS}/${orderId}`
    );
    return response.order;
  }

  /**
   * Get user orders with pagination
   */
  async getUserOrders(page: number = 1, limit: number = 10): Promise<PaginatedOrders> {
    const response = await apiClient.get<{ 
      success: boolean; 
      orders: Order[]; 
      pagination: any;
      count: number;
    }>(`${API_ENDPOINTS.ORDERS}?page=${page}&limit=${limit}`);
    
    return {
      orders: response.orders,
      pagination: response.pagination,
      count: response.count
    };
  }

  /**
   * Cancel an order
   */
  async cancelOrder(orderId: string, reason?: string): Promise<{ success: boolean; message: string }> {
    const response = await apiClient.put<{ success: boolean; message: string }>(
      API_ENDPOINTS.ORDER_CANCEL(orderId),
      { reason }
    );
    return response;
  }

  /**
   * Delete an order
   */
  async deleteOrder(orderId: string): Promise<{ success: boolean; message: string }> {
    const response = await apiClient.delete<{ success: boolean; message: string }>(
      `${API_ENDPOINTS.ORDERS}/${orderId}`
    );
    return response;
  }
}

export default new OrderService();
