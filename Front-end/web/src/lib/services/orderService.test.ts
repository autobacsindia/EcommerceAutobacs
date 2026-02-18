import orderService from './orderService';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';

jest.mock('@/lib/api', () => {
  const get = jest.fn();
  const post = jest.fn();
  const put = jest.fn();
  const del = jest.fn(); // 'delete' is a reserved word
  return {
    __esModule: true,
    default: { get, post, put, delete: del },
  };
});

const mockedApiClient = apiClient as any;

describe('OrderService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createOrder', () => {
    it('should create an order successfully', async () => {
      const orderData = {
        shippingAddress: {
          fullName: 'John Doe',
          addressLine1: '123 Main St',
          city: 'City',
          state: 'State',
          postalCode: '12345',
          country: 'Country',
          phone: '1234567890',
        },
        paymentMethod: 'cod',
        items: [{ product: 'p1', quantity: 1, price: 100 }],
        subtotal: 100,
        tax: 10,
        shippingCost: 0,
        discount: 0,
        totalAmount: 110,
      };

      const responseData = { success: true, order: { _id: 'order1', ...orderData } };
      mockedApiClient.post.mockResolvedValue(responseData);

      const result = await orderService.createOrder(orderData);

      expect(mockedApiClient.post).toHaveBeenCalledWith(API_ENDPOINTS.ORDERS, orderData);
      expect(result).toEqual(responseData);
    });
  });

  describe('getOrderById', () => {
    it('should get order details by ID', async () => {
      const orderId = 'order1';
      const responseData = { success: true, order: { _id: orderId, totalAmount: 100 } };
      mockedApiClient.get.mockResolvedValue(responseData);

      const result = await orderService.getOrderById(orderId);

      expect(mockedApiClient.get).toHaveBeenCalledWith(`${API_ENDPOINTS.ORDERS}/${orderId}`);
      expect(result).toEqual(responseData.order);
    });
  });

  describe('getUserOrders', () => {
    it('should get user orders with pagination', async () => {
      const page = 1;
      const limit = 10;
      const responseData = {
        success: true,
        orders: [{ _id: 'order1' }],
        pagination: { total: 1 },
        count: 1,
      };
      mockedApiClient.get.mockResolvedValue(responseData);

      const result = await orderService.getUserOrders(page, limit);

      expect(mockedApiClient.get).toHaveBeenCalledWith(`${API_ENDPOINTS.ORDERS}?page=${page}&limit=${limit}`);
      expect(result).toEqual({
        orders: responseData.orders,
        pagination: responseData.pagination,
        count: responseData.count,
      });
    });
  });

  describe('cancelOrder', () => {
    it('should cancel an order', async () => {
      const orderId = 'order1';
      const reason = 'Changed mind';
      const responseData = { success: true, message: 'Order cancelled' };
      mockedApiClient.put.mockResolvedValue(responseData);

      const result = await orderService.cancelOrder(orderId, reason);

      expect(mockedApiClient.put).toHaveBeenCalledWith(API_ENDPOINTS.ORDER_CANCEL(orderId), { reason });
      expect(result).toEqual(responseData);
    });
  });

  describe('deleteOrder', () => {
    it('should delete an order', async () => {
      const orderId = 'order1';
      const responseData = { success: true, message: 'Order deleted' };
      mockedApiClient.delete.mockResolvedValue(responseData);

      const result = await orderService.deleteOrder(orderId);

      expect(mockedApiClient.delete).toHaveBeenCalledWith(`${API_ENDPOINTS.ORDERS}/${orderId}`);
      expect(result).toEqual(responseData);
    });
  });
});
