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

// Split shipments: a `shipped` transition now builds a PARCEL rather than only
// flipping the order's status, so the controller depends on this service.
const mockShipmentService = {
  createShipment: jest.fn(),
  markShipmentDelivered: jest.fn(),
  markShipmentLost: jest.fn(),
  getFulfilment: jest.fn(),
};

const mockOrderTrackingService = {
  generateTrackingNumber: jest.fn(),
  addTrackingInfo: jest.fn(),
  getTrackingHistory: jest.fn(),
  addTrackingEvent: jest.fn(),
  trackByNumber: jest.fn(),
  getCarrier: jest.fn(),
  resolveCarrier: jest.fn(),
  buildCarrierSubdoc: jest.fn(),
  getSupportedCarriers: jest.fn(),
  simulateTracking: jest.fn(),
  getTrackingStatistics: jest.fn(),
};

// Setup mocks
jest.unstable_mockModule('../../../models/Order.js', () => ({ default: mockOrder }));
jest.unstable_mockModule('../../../models/Cart.js', () => ({ default: mockCart }));
jest.unstable_mockModule('../../../models/Product.js', () => ({ default: mockProduct }));
jest.unstable_mockModule('../../../services/orderStatusService.js', () => ({ default: mockOrderStatusService }));
jest.unstable_mockModule('../../../services/shipmentService.js', () => ({ default: mockShipmentService }));
jest.unstable_mockModule('../../../services/orderTrackingService.js', () => ({
  default: mockOrderTrackingService,
  OTHER_CARRIER_CODE: 'OTHER',
}));
// Loyalty disabled here so the pricing engine skips the karma balance lookup — this
// controller test mocks only the Order/Cart/Product models and uses a non-ObjectId user id.
// The return is set in beforeEach because jest.config resetMocks:true wipes factory impls.
const mockGetLoyaltyConfig = jest.fn();
jest.unstable_mockModule('../../../services/loyaltyConfigService.js', () => ({
  getLoyaltyConfig: mockGetLoyaltyConfig,
  invalidateLoyaltyConfig: jest.fn(),
}));

const { userCartFilter } = await import('../../../repositories/cartRepository.js');
const { CUSTOMER_LIST_FIELDS } = await import('../../../repositories/orderProjections.js');

// Import controller
const { 
  getOrders,
  createOrder,
  cancelOrder,
  updateOrderStatus,
  addTracking,
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
        // The list read is projected — the card renders a handful of fields against a
        // ~1829 B document. See repositories/orderProjections.js.
        select: jest.fn().mockReturnThis(),
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
      // Projected, not the whole document — `statusHistory` and friends stay out.
      expect(mockChain.select).toHaveBeenCalledWith(CUSTOMER_LIST_FIELDS);
      
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
      // The serialized order gained payment / refundDetails / returnRequest fields.
      // Matching the whole object pinned an exact response shape, so every additive
      // change broke the test without any behaviour regressing.
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        order: expect.objectContaining(mockOrderDoc)
      }));
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
      // The cart filter now restates `$type` so the partial `user_1` index is
      // usable (a bare `{ user }` COLLSCANned the whole collection — see
      // repositories/cartRepository.js). Assert through the helper so this stays
      // correct if the filter shape changes again.
      expect(mockCart.findOneAndUpdate).toHaveBeenCalledWith(
        userCartFilter('user-id'),
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
    it('should update status successfully (Admin) and pass tracking to the service', async () => {
      req.user.role = 'admin';
      req.params.id = 'order-id';
      // No slip file → JSON path, no Cloudinary upload.
      req.body = { status: 'shipped', trackingNumber: '12345', carrierCode: 'DELHIVERY' };

      mockOrderTrackingService.resolveCarrier.mockReturnValue({
        carrier: {
          name: 'Delhivery',
          code: 'DELHIVERY',
          trackingUrl: 'https://d.example/',
          estimatedDeliveryDays: 2,
        },
        error: null,
      });
      mockOrderTrackingService.buildCarrierSubdoc.mockReturnValue({
        name: 'Delhivery',
        code: 'DELHIVERY',
        trackingUrl: 'https://d.example/12345',
      });

      const resultOrder = { _id: 'order-id', status: 'shipped', trackingNumber: '12345' };
      mockShipmentService.createShipment.mockResolvedValue({
        success: true,
        order: resultOrder,
        shipment: { _id: 'ship-1', sequence: 1 },
        message: 'Parcel 1 created',
      });

      await updateOrderStatus(req, res);

      /*
        A `shipped` transition creates a PARCEL carrying the resolved tracking + carrier.
        With no `lines` in the body it covers everything the order still owes, which is
        the old whole-order behaviour — now recorded as a shipment so the AWB, slip and
        delivery date belong to a box rather than to the order.
      */
      expect(mockShipmentService.createShipment).toHaveBeenCalledWith(
        'order-id',
        expect.objectContaining({
          lines: undefined, // "everything outstanding"
          trackingNumber: '12345',
          carrier: expect.objectContaining({ code: 'DELHIVERY', trackingUrl: 'https://d.example/12345' }),
        }),
        expect.objectContaining({ userId: req.user.id }),
      );

      // The status roll-up happens INSIDE createShipment. Calling the status service
      // again here would double-write status history on every dispatch.
      expect(mockOrderStatusService.updateOrderStatus).not.toHaveBeenCalled();

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        order: resultOrder,
      }));
    });

    it('rejects an unknown carrier code', async () => {
      req.user.role = 'admin';
      req.params.id = 'order-id';
      req.body = { status: 'shipped', trackingNumber: '12345', carrierCode: 'NOPE' };
      mockOrderTrackingService.resolveCarrier.mockReturnValue({
        carrier: null,
        error: 'Unknown carrier code: NOPE',
      });

      await updateOrderStatus(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockOrderStatusService.updateOrderStatus).not.toHaveBeenCalled();
      expect(mockShipmentService.createShipment).not.toHaveBeenCalled();
    });

    it('ships with the "Other" carrier using the admin-typed courier name', async () => {
      req.user.role = 'admin';
      req.params.id = 'order-id';
      req.body = {
        status: 'shipped',
        trackingNumber: 'TRK-99',
        carrierCode: 'OTHER',
        carrierName: 'Trackon Couriers',
      };

      // No trackingUrl pattern for an unlisted courier → no link is persisted.
      mockOrderTrackingService.resolveCarrier.mockReturnValue({
        carrier: { name: 'Trackon Couriers', code: 'OTHER', trackingUrl: null, custom: true },
        error: null,
      });
      mockOrderTrackingService.buildCarrierSubdoc.mockReturnValue({
        name: 'Trackon Couriers',
        code: 'OTHER',
      });
      mockShipmentService.createShipment.mockResolvedValue({
        success: true,
        order: { _id: 'order-id', status: 'shipped' },
        shipment: { _id: 'ship-1', sequence: 1 },
        message: 'Parcel 1 created',
      });

      await updateOrderStatus(req, res);

      expect(mockOrderTrackingService.resolveCarrier).toHaveBeenCalledWith('OTHER', 'Trackon Couriers');
      const parcel = mockShipmentService.createShipment.mock.calls[0][1];
      expect(parcel.carrier).toEqual({ name: 'Trackon Couriers', code: 'OTHER' });
      expect(parcel.carrier.trackingUrl).toBeUndefined();
      // No SLA for an unknown courier → no invented ETA in the customer email.
      expect(parcel.estimatedDelivery).toBeUndefined();
    });

    it('rejects the "Other" carrier without a courier name', async () => {
      req.user.role = 'admin';
      req.params.id = 'order-id';
      req.body = { status: 'shipped', trackingNumber: 'TRK-99', carrierCode: 'OTHER' };
      mockOrderTrackingService.resolveCarrier.mockReturnValue({
        carrier: null,
        error: 'Courier name is required when the carrier is "Other"',
      });

      await updateOrderStatus(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        message: 'Courier name is required when the carrier is "Other"',
      }));
      expect(mockOrderStatusService.updateOrderStatus).not.toHaveBeenCalled();
    });
  });

  describe('addTracking', () => {
    it('requires a tracking number for the "Other" carrier (none can be generated)', async () => {
      req.user.role = 'admin';
      req.params.id = 'order-id';
      req.body = { carrierCode: 'OTHER', carrierName: 'Trackon Couriers' };

      await addTracking(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockOrderTrackingService.generateTrackingNumber).not.toHaveBeenCalled();
      expect(mockOrderTrackingService.addTrackingInfo).not.toHaveBeenCalled();
    });

    it('threads the courier name through to the tracking service', async () => {
      req.user.role = 'admin';
      req.params.id = 'order-id';
      req.body = { carrierCode: 'OTHER', carrierName: 'Trackon Couriers', trackingNumber: 'TRK-99' };
      mockOrderTrackingService.addTrackingInfo.mockResolvedValue({
        success: true,
        order: { _id: 'order-id' },
        trackingUrl: undefined,
      });

      await addTracking(req, res);

      expect(mockOrderTrackingService.addTrackingInfo).toHaveBeenCalledWith(
        'order-id',
        expect.objectContaining({
          trackingNumber: 'TRK-99',
          carrierCode: 'OTHER',
          carrierName: 'Trackon Couriers',
        })
      );
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
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
