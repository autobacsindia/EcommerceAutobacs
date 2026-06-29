import { jest } from '@jest/globals';

// Mock dependencies
const mockOrder = {
  find: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  countDocuments: jest.fn(),
  findOneAndUpdate: jest.fn(),
};

const mockCart = {
  findOneAndUpdate: jest.fn(),
};

const mockProduct = {
  findById: jest.fn(),
  findOne: jest.fn(),
  findByIdAndUpdate: jest.fn(),
};

const mockOrderStatusService = {
  updateOrderStatus: jest.fn(),
  getStatusHistory: jest.fn(),
  getValidNextStatuses: jest.fn(),
  getValidReasons: jest.fn(),
  getStatusStatistics: jest.fn(),
  getFulfillmentMetrics: jest.fn(),
};

const mockOrderTrackingService = {
  generateTrackingNumber: jest.fn(),
  addTrackingInfo: jest.fn(),
  getTrackingHistory: jest.fn(),
  addTrackingEvent: jest.fn(),
  trackByNumber: jest.fn(),
  getSupportedCarriers: jest.fn(),
  simulateTracking: jest.fn(),
  getTrackingStatistics: jest.fn(),
};

// Setup mocks
jest.unstable_mockModule('../../../models/Order.js', () => ({ default: mockOrder }));
jest.unstable_mockModule('../../../models/Cart.js', () => ({ default: mockCart }));
jest.unstable_mockModule('../../../models/Product.js', () => ({ default: mockProduct }));
jest.unstable_mockModule('../../../services/orderStatusService.js', () => ({ default: mockOrderStatusService }));
jest.unstable_mockModule('../../../services/orderTrackingService.js', () => ({ default: mockOrderTrackingService }));
// Loyalty disabled here so the pricing engine skips the karma balance lookup — this
// controller test mocks only the Order/Cart/Product models and uses a non-ObjectId user id.
// The return is set in beforeEach because jest.config resetMocks:true wipes factory impls.
const mockGetLoyaltyConfig = jest.fn();
jest.unstable_mockModule('../../../services/loyaltyConfigService.js', () => ({
  getLoyaltyConfig: mockGetLoyaltyConfig,
  invalidateLoyaltyConfig: jest.fn(),
}));

// Import controller
const { 
  getOrders,
  createOrder,
  cancelOrder,
  updateOrderStatus,
  getOrderById,
  submitReturnRequest,
  updateReturnStatus
} = await import('../../../controllers/orderController.js');

describe('OrderController Unit Tests', () => {
  let req, res;

  beforeEach(() => {
    jest.clearAllMocks();

    // Re-arm after resetMocks: loyalty off → pricing engine skips the karma path.
    mockGetLoyaltyConfig.mockResolvedValue({
      enabled: false, earnRatePercent: 2, pointsExpiryDays: null,
      pointValueInRupees: 1, redeemMaxPercent: 20, minRedeemPoints: 100,
    });

    req = {
      query: {},
      params: {},
      body: {},
      headers: {},
      user: {
        id: 'user-id',
        role: 'user'
      }
    };
    
    res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };
  });

  describe('getOrders', () => {
    it('should return paginated orders for the user', async () => {
      const mockOrdersList = [{ _id: 'o1' }, { _id: 'o2' }];
      
      const mockChain = {
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockOrdersList)
      };
      
      mockOrder.find.mockReturnValue(mockChain);
      mockOrder.countDocuments.mockResolvedValue(20);
      
      req.query = { page: '1', limit: '10' };
      
      await getOrders(req, res);
      
      expect(mockOrder.find).toHaveBeenCalledWith({ user: 'user-id' });
      expect(mockChain.populate).toHaveBeenCalledWith('items.product', 'name images');
      expect(mockChain.sort).toHaveBeenCalledWith({ createdAt: -1 });
      expect(mockChain.skip).toHaveBeenCalledWith(0);
      expect(mockChain.limit).toHaveBeenCalledWith(10);
      
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        count: 2,
        orders: mockOrdersList,
        pagination: expect.objectContaining({
          currentPage: 1,
          totalOrders: 20
        })
      }));
    });
  });

  describe('getOrderById', () => {
    it('should return order if found and authorized', async () => {
      const mockOrderDoc = {
        _id: 'order-id',
        user: { _id: 'user-id' },
        items: []
      };

      const mockChain = {
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockOrderDoc)
      };

      mockOrder.findById.mockReturnValue(mockChain);
      req.params.id = 'order-id';

      await getOrderById(req, res);

      expect(mockOrder.findById).toHaveBeenCalledWith('order-id');
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        order: mockOrderDoc
      });
    });

    it('should return 404 if order not found', async () => {
      const mockChain = {
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(null)
      };

      mockOrder.findById.mockReturnValue(mockChain);
      req.params.id = 'non-existent';

      await getOrderById(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        message: 'Order not found'
      }));
    });

    it('should return 403 if user is not authorized', async () => {
      const mockOrderDoc = {
        _id: 'order-id',
        user: { _id: 'other-user' },
        items: []
      };

      const mockChain = {
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockOrderDoc)
      };

      mockOrder.findById.mockReturnValue(mockChain);
      req.params.id = 'order-id';

      await getOrderById(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        message: 'Not authorized to access this order'
      }));
    });
  });

  describe('createOrder', () => {
    it('should create order successfully', async () => {
      req.body = {
        items: [{ product: 'p1', quantity: 2 }],
        shippingAddress: { city: 'Test City' },
        shippingCost: 10
      };

      const mockProductDoc = {
        _id: 'p1',
        name: 'Test Product',
        price: 100,
        stock: 'in',
        isActive: true,
        images: [{ url: 'img.jpg' }]
      };

      // findActiveById (used during validation) queries via findOne
      mockProduct.findById.mockResolvedValue(mockProductDoc);
      mockProduct.findOne.mockResolvedValue(mockProductDoc);

      const createdOrder = { _id: 'new-order', totalAmount: 210 };
      // BaseRepository.create uses Model.create([data], { session }) inside the
      // transaction and unwraps the array, so the mock must resolve an array.
      mockOrder.create.mockResolvedValue([createdOrder]);

      await createOrder(req, res);

      // Validation resolves the product via findOne (findActiveById)
      expect(mockProduct.findOne).toHaveBeenCalled();
      expect(mockOrder.create).toHaveBeenCalled();

      // Stock is a coarse status — orders no longer mutate product stock.
      expect(mockProduct.findByIdAndUpdate).not.toHaveBeenCalled();

      // Cart clear (called with a transaction session as the 3rd arg)
      expect(mockCart.findOneAndUpdate).toHaveBeenCalledWith(
        { user: 'user-id' },
        { items: [] },
        expect.objectContaining({ session: expect.anything() })
      );

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        order: createdOrder
      }));
    });

    it('should fail if product is out of stock', async () => {
      req.body = {
        items: [{ product: 'p1', quantity: 1 }]
      };

      const mockProductDoc = {
        _id: 'p1',
        name: 'Test Product',
        price: 100,
        stock: 'out',
        isActive: true
      };

      mockProduct.findById.mockResolvedValue(mockProductDoc);
      mockProduct.findOne.mockResolvedValue(mockProductDoc);

      await createOrder(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        message: expect.stringContaining('out of stock')
      }));
    });
  });

  describe('cancelOrder', () => {
    it('should cancel order without touching product stock', async () => {
      const mockOrderDoc = {
        _id: 'order-id',
        status: 'pending',
        items: [{ product: 'p1', quantity: 2 }],
        payment: null,
        save: jest.fn().mockResolvedValue(true)
      };

      req.order = mockOrderDoc; // From middleware
      req.body = { reason: 'Changed mind' };

      const mockServiceResult = {
        success: true,
        order: { ...mockOrderDoc, status: 'cancelled' }
      };

      mockOrderStatusService.updateOrderStatus.mockResolvedValue(mockServiceResult);

      await cancelOrder(req, res);

      expect(mockOrderStatusService.updateOrderStatus).toHaveBeenCalledWith(
        'order-id',
        'cancelled',
        expect.objectContaining({
          reason: 'Changed mind',
          userId: 'user-id'
        })
      );

      // Stock is a coarse status — cancellation does not restore quantity.
      expect(mockProduct.findByIdAndUpdate).not.toHaveBeenCalled();

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        message: 'Order cancelled successfully',
        refundInitiated: false
      }));
    });
  });

  describe('updateOrderStatus', () => {
    it('should update status successfully (Admin)', async () => {
      req.user.role = 'admin';
      req.params.id = 'order-id';
      req.body = { status: 'shipped', trackingNumber: '12345' };

      const mockServiceResult = {
        success: true,
        order: { 
          _id: 'order-id', 
          status: 'shipped',
          save: jest.fn().mockResolvedValue(true) 
        },
        message: 'Status updated'
      };

      mockOrderStatusService.updateOrderStatus.mockResolvedValue(mockServiceResult);

      await updateOrderStatus(req, res);

      expect(mockOrderStatusService.updateOrderStatus).toHaveBeenCalledWith(
        'order-id',
        'shipped',
        expect.objectContaining({ isAdmin: true })
      );

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        order: expect.objectContaining({ trackingNumber: '12345' })
      }));
    });
  });

  describe('submitReturnRequest', () => {
    it('should submit return request successfully', async () => {
      const mockOrderDoc = {
        _id: 'order-id',
        user: 'user-id',
        status: 'delivered',
        deliveredAt: new Date(),
        items: [{ product: 'p1', quantity: 1 }],
        save: jest.fn().mockResolvedValue(true)
      };

      mockOrder.findById.mockResolvedValue(mockOrderDoc);

      req.params.id = 'order-id';
      req.body = {
        items: [{ productId: 'p1', quantity: 1, reason: 'defective' }],
        reason: 'defective',
        description: 'Product is broken'
      };

      await submitReturnRequest(req, res);

      expect(mockOrderDoc.save).toHaveBeenCalled();
      expect(mockOrderDoc.returnRequest).toEqual(expect.objectContaining({
        status: 'pending',
        reason: 'defective'
      }));

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        message: 'Return request submitted successfully'
      }));
    });

    it('should fail if order is not delivered', async () => {
      const mockOrderDoc = {
        _id: 'order-id',
        user: 'user-id',
        status: 'shipped' // Not delivered
      };

      mockOrder.findById.mockResolvedValue(mockOrderDoc);
      req.params.id = 'order-id';
      req.body = { items: [] };

      await submitReturnRequest(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        message: expect.stringContaining('Only delivered orders can be returned')
      }));
    });
  });

  describe('updateReturnStatus', () => {
    it('should update return status successfully', async () => {
      const mockOrderDoc = {
        _id: 'order-id',
        returnRequest: { status: 'pending' },
        save: jest.fn().mockResolvedValue(true)
      };

      mockOrder.findById.mockResolvedValue(mockOrderDoc);

      req.params.id = 'order-id';
      req.body = { status: 'approved', adminNotes: 'Approved return' };

      await updateReturnStatus(req, res);

      expect(mockOrderDoc.returnRequest.status).toBe('approved');
      expect(mockOrderDoc.returnRequest.adminNotes).toBe('Approved return');
      expect(mockOrderDoc.save).toHaveBeenCalled();

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        message: 'Return request status updated'
      }));
    });
  });
});
