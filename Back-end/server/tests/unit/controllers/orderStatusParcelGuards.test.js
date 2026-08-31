import { jest } from '@jest/globals';

/**
 * The parcel guards on the ADMIN status-change paths.
 *
 * Split shipments made `Order.status` a roll-up of the parcels rather than a thing an
 * admin sets directly, and two write paths were still setting it directly:
 *
 *   • PUT /orders/:id/status with `delivered` — `deliverAllOutstanding` marks every
 *     EXISTING parcel delivered, but it cannot deliver units that were never boxed. Ship
 *     1 of 3 items, flip the order to `delivered`, and the other 2 have no delivery date
 *     forever, so their return window never opens while the customer is told everything
 *     arrived.
 *
 *   • POST /orders/bulk/status — bypassed the parcel model entirely for every status.
 *     `delivered` left parcels at `shipped` (return windows shut, the exact bug the
 *     single-order path documents having fixed); `shipped` wrote a status with no parcel
 *     and, per validateBulkStatusUpdate, no tracking number at all.
 *
 * These tests pin both, plus the legacy escape hatch: an order with NO parcels predates
 * split shipments and must keep behaving exactly as it always did.
 *
 * Mocked at the repository/service boundary, like returnController.test.js.
 */

const mockOrderRepo = {
  findById: jest.fn(),
  save: jest.fn(),
};
const mockShipmentService = {
  createShipment: jest.fn(),
  deliverAllOutstanding: jest.fn(),
  dispatchAllPacked: jest.fn(),
};
const mockOrderStatusService = {
  updateOrderStatus: jest.fn(),
  validateTransition: jest.fn(),
};
const mockTracking = {
  resolveCarrier: jest.fn(),
  buildCarrierSubdoc: jest.fn(),
};
const mockCancellationService = {
  cancelLines: jest.fn(),
};

jest.unstable_mockModule('../../../repositories/orderRepository.js', () => ({ default: mockOrderRepo }));
jest.unstable_mockModule('../../../services/shipmentService.js', () => ({ default: mockShipmentService }));
jest.unstable_mockModule('../../../services/orderStatusService.js', () => ({ default: mockOrderStatusService }));
jest.unstable_mockModule('../../../services/orderTrackingService.js', () => ({
  default: mockTracking,
  OTHER_CARRIER_CODE: 'OTHER',
}));
jest.unstable_mockModule('../../../services/cancellationService.js', () => ({ default: mockCancellationService }));

const { updateOrderStatus, bulkUpdateStatus, cancelOrder } =
  await import('../../../controllers/orderController.js');

const ADMIN = { id: 'admin-1', role: 'admin' };

async function run(handler, req) {
  const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
  await handler(req, res, () => {});
  return {
    res,
    status: res.status.mock.calls[0]?.[0],
    body: res.json.mock.calls[0]?.[0],
  };
}

/** Two items; the caller says what has been parcelled. */
const order = (shipments = [], items = [
  { _id: 'i1', name: 'Wiper', product: 'p1', quantity: 1 },
  { _id: 'i2', name: 'Mat', product: 'p2', quantity: 2 },
]) => ({ _id: 'order-1', status: 'shipped', paymentStatus: 'paid', items, shipments, cancellations: [] });

const parcel = (status, lines, id = 's1') => ({ _id: id, status, lines, deliveredAt: status === 'delivered' ? new Date() : undefined });

beforeEach(() => {
  jest.clearAllMocks();
  mockOrderStatusService.updateOrderStatus.mockResolvedValue({ success: true, message: 'ok', order: {} });
  mockShipmentService.deliverAllOutstanding.mockResolvedValue({ delivered: 0 });
  mockShipmentService.dispatchAllPacked.mockResolvedValue({ dispatched: 0 });
});

describe('PUT /orders/:id/cancel on a partially shipped order', () => {
  const CUSTOMER = { id: 'u1', role: 'customer' };

  /*
    The plain whole-order transition cannot express "cancel what has not left yet": it
    would cancel goods already in transit AND flag an order-level refund for the full
    total, including the parcel the customer is about to receive. So the remainder is
    routed through cancellationService, which prices each line net of the order's
    discount and records a per-line refund.
  */
  it('cancels only the un-shipped lines, and says the rest is still coming', async () => {
    // i1 is in a shipped parcel; i2 ×2 never left.
    const partiallyShipped = order([parcel('shipped', [{ itemId: 'i1', quantity: 1 }])]);
    mockCancellationService.cancelLines.mockResolvedValue({
      success: true,
      order: { ...partiallyShipped, status: 'shipped' }, // still shipped: a parcel is live
      refund: { status: 'pending', amountRupees: 400 },
    });

    const { body } = await run(cancelOrder, {
      order: partiallyShipped, params: { id: 'order-1' }, body: {}, user: CUSTOMER,
    });

    expect(mockCancellationService.cancelLines).toHaveBeenCalledWith(
      'order-1',
      expect.objectContaining({ lines: [{ itemId: 'i2', quantity: 2 }] }),
      { userId: 'u1' },
    );
    // The whole-order transition must NOT also run.
    expect(mockOrderStatusService.updateOrderStatus).not.toHaveBeenCalled();

    expect(body.success).toBe(true);
    expect(body.partial).toBe(true);
    expect(body.cancelledLines).toBe(1);
    expect(body.message).toMatch(/still on its way/i);
    expect(body.refundInitiated).toBe(true);
  });

  it('reports a full cancellation plainly when the last live line goes', async () => {
    const nothingShipped = order([]);
    mockCancellationService.cancelLines.mockResolvedValue({
      success: true,
      order: { ...nothingShipped, status: 'cancelled' },
      refund: { status: 'pending', amountRupees: 900 },
    });
    // Prior cancellations already route through the per-line path.
    nothingShipped.cancellations = [{ lines: [{ itemId: 'i1', quantity: 1 }] }];

    const { body } = await run(cancelOrder, {
      order: nothingShipped, params: { id: 'order-1' }, body: {}, user: CUSTOMER,
    });

    expect(body.partial).toBe(false);
    expect(body.message).toBe('Order cancelled successfully');
  });

  it('surfaces a service rejection as a 400 rather than a silent success', async () => {
    mockCancellationService.cancelLines.mockResolvedValue({
      success: false, message: 'Cannot cancel lines on an order in \'delivered\'.',
    });

    const { status, body } = await run(cancelOrder, {
      order: order([parcel('shipped', [{ itemId: 'i1', quantity: 1 }])]),
      params: { id: 'order-1' }, body: {}, user: CUSTOMER,
    });

    expect(status).toBe(400);
    expect(body.success).toBe(false);
  });

  it('leaves an ordinary processing order on the whole-order path', async () => {
    const processing = { ...order([]), status: 'processing' };
    mockOrderStatusService.updateOrderStatus.mockResolvedValue({
      success: true, message: 'ok', order: { ...processing, status: 'cancelled', refundDetails: {} },
    });

    await run(cancelOrder, { order: processing, params: { id: 'order-1' }, body: {}, user: CUSTOMER });

    expect(mockCancellationService.cancelLines).not.toHaveBeenCalled();
    expect(mockOrderStatusService.updateOrderStatus).toHaveBeenCalledWith(
      'order-1', 'cancelled', expect.objectContaining({ cancelledBy: 'customer' }));
  });
});

describe('PUT /orders/:id/status → delivered', () => {
  it('refuses when part of the order was never put in a parcel', async () => {
    // i1 shipped, i2 ×2 never boxed.
    mockOrderRepo.findById.mockResolvedValue(order([parcel('delivered', [{ itemId: 'i1', quantity: 1 }])]));

    const { status, body } = await run(updateOrderStatus, {
      params: { id: 'order-1' }, body: { status: 'delivered' }, user: ADMIN,
    });

    expect(status).toBe(400);
    expect(body.message).toMatch(/never been shipped/i);
    expect(body.message).toMatch(/Mat ×2/);
    // Nothing was half-delivered on the way to the rejection.
    expect(mockShipmentService.deliverAllOutstanding).not.toHaveBeenCalled();
    expect(mockOrderStatusService.updateOrderStatus).not.toHaveBeenCalled();
  });

  it('allows it once every unit is accounted for by a parcel', async () => {
    mockOrderRepo.findById.mockResolvedValue(order([
      parcel('shipped', [{ itemId: 'i1', quantity: 1 }, { itemId: 'i2', quantity: 2 }]),
    ]));
    mockShipmentService.deliverAllOutstanding.mockResolvedValue({ delivered: 1 });

    const { body } = await run(updateOrderStatus, {
      params: { id: 'order-1' }, body: { status: 'delivered' }, user: ADMIN,
    });

    expect(body.success).toBe(true);
    expect(mockShipmentService.deliverAllOutstanding).toHaveBeenCalledWith('order-1');
    // Parcels emailed the customer themselves, so the order-level email is suppressed.
    expect(mockOrderStatusService.updateOrderStatus).toHaveBeenCalledWith(
      'order-1', 'delivered', expect.objectContaining({ suppressStatusEmail: true }));
  });

  it('counts a cancelled line as accounted for rather than blocking on it', async () => {
    const o = order([parcel('shipped', [{ itemId: 'i1', quantity: 1 }])]);
    o.cancellations = [{ lines: [{ itemId: 'i2', quantity: 2 }] }];
    mockOrderRepo.findById.mockResolvedValue(o);

    const { body } = await run(updateOrderStatus, {
      params: { id: 'order-1' }, body: { status: 'delivered' }, user: ADMIN,
    });

    expect(body.success).toBe(true);
  });

  /*
    Every order placed before split shipments carries no parcels at all. remainingToShip
    reports all of its lines (nothing is in a box), so guarding on that alone would block
    `delivered` on the entire back catalogue. They are safe because deliveredAtForItem
    falls back to the order-level date when there are no parcels.
  */
  it('leaves a pre-parcel order alone — no parcels means no partial state to protect', async () => {
    mockOrderRepo.findById.mockResolvedValue(order([]));

    const { body } = await run(updateOrderStatus, {
      params: { id: 'order-1' }, body: { status: 'delivered' }, user: ADMIN,
    });

    expect(body.success).toBe(true);
    expect(mockOrderStatusService.updateOrderStatus).toHaveBeenCalledWith(
      'order-1', 'delivered', expect.objectContaining({ suppressStatusEmail: false }));
  });

  it('404s when the order does not exist', async () => {
    mockOrderRepo.findById.mockResolvedValue(null);
    const { status } = await run(updateOrderStatus, {
      params: { id: 'nope' }, body: { status: 'delivered' }, user: ADMIN,
    });
    expect(status).toBe(404);
  });
});

describe('POST /orders/bulk/status → delivered', () => {
  it('delivers each order\'s parcels, so the per-line return windows actually open', async () => {
    mockOrderRepo.findById.mockResolvedValue(order([
      parcel('shipped', [{ itemId: 'i1', quantity: 1 }, { itemId: 'i2', quantity: 2 }]),
    ]));
    mockShipmentService.deliverAllOutstanding.mockResolvedValue({ delivered: 1 });

    const { body } = await run(bulkUpdateStatus, {
      body: { orderIds: ['order-1', 'order-2'], status: 'delivered' }, user: ADMIN,
    });

    expect(mockShipmentService.deliverAllOutstanding).toHaveBeenCalledTimes(2);
    expect(body.results.successful).toHaveLength(2);
    expect(body.results.failed).toHaveLength(0);
    expect(mockOrderStatusService.updateOrderStatus).toHaveBeenCalledWith(
      'order-1', 'delivered', expect.objectContaining({ suppressStatusEmail: true }));
  });

  it('reports the partially-shipped order as failed instead of writing a wrong status', async () => {
    mockOrderRepo.findById.mockResolvedValue(order([parcel('shipped', [{ itemId: 'i1', quantity: 1 }])]));

    const { body } = await run(bulkUpdateStatus, {
      body: { orderIds: ['order-1'], status: 'delivered' }, user: ADMIN,
    });

    expect(body.results.successful).toHaveLength(0);
    expect(body.results.failed[0]).toMatchObject({ orderId: 'order-1' });
    expect(body.results.failed[0].error).toMatch(/never been shipped/i);
    expect(mockOrderStatusService.updateOrderStatus).not.toHaveBeenCalled();
  });

  it('keeps the single order-level email for a pre-parcel order', async () => {
    mockOrderRepo.findById.mockResolvedValue(order([]));

    await run(bulkUpdateStatus, { body: { orderIds: ['order-1'], status: 'delivered' }, user: ADMIN });

    expect(mockOrderStatusService.updateOrderStatus).toHaveBeenCalledWith(
      'order-1', 'delivered', expect.objectContaining({ suppressStatusEmail: false }));
  });
});

describe('POST /orders/bulk/status → shipped', () => {
  /*
    Bulk carries no carrier and no AWB — validateBulkStatusUpdate does not even accept
    one — so it must never CREATE a parcel. One shared tracking number across a selection
    would be wrong data on all but one order.
  */
  it('refuses to invent a parcel for units that have never been boxed', async () => {
    mockOrderRepo.findById.mockResolvedValue(order([]));

    const { body } = await run(bulkUpdateStatus, {
      body: { orderIds: ['order-1'], status: 'shipped' }, user: ADMIN,
    });

    expect(body.results.successful).toHaveLength(0);
    expect(body.results.failed[0].error).toMatch(/Parcels panel/);
    expect(mockShipmentService.createShipment).not.toHaveBeenCalled();
    expect(mockOrderStatusService.updateOrderStatus).not.toHaveBeenCalled();
  });

  it('dispatches parcels that are already packed — no new courier data needed', async () => {
    mockOrderRepo.findById.mockResolvedValue(order([
      parcel('packed', [{ itemId: 'i1', quantity: 1 }, { itemId: 'i2', quantity: 2 }]),
    ]));
    mockShipmentService.dispatchAllPacked.mockResolvedValue({ dispatched: 1 });

    const { body } = await run(bulkUpdateStatus, {
      body: { orderIds: ['order-1'], status: 'shipped' }, user: ADMIN,
    });

    expect(mockShipmentService.dispatchAllPacked).toHaveBeenCalledWith('order-1');
    expect(body.results.successful).toHaveLength(1);
    // Each parcel emailed its own dispatch notice.
    expect(mockOrderStatusService.updateOrderStatus).toHaveBeenCalledWith(
      'order-1', 'shipped', expect.objectContaining({ suppressStatusEmail: true }));
  });

  /*
    The order-level "shipped" email is keyed separately from the per-parcel ones, so
    re-running the status update on an order whose parcels already went out would send a
    SECOND dispatch notice for goods the customer may already be holding.
  */
  it('is a quiet no-op on an order whose parcels have all already gone', async () => {
    mockOrderRepo.findById.mockResolvedValue(order([
      parcel('shipped', [{ itemId: 'i1', quantity: 1 }, { itemId: 'i2', quantity: 2 }]),
    ]));
    mockShipmentService.dispatchAllPacked.mockResolvedValue({ dispatched: 0 });

    const { body } = await run(bulkUpdateStatus, {
      body: { orderIds: ['order-1'], status: 'shipped' }, user: ADMIN,
    });

    expect(body.results.successful).toHaveLength(1);
    expect(body.results.failed).toHaveLength(0);
    expect(mockOrderStatusService.updateOrderStatus).not.toHaveBeenCalled();
  });

  it('names the failing order rather than failing the whole batch', async () => {
    mockOrderRepo.findById
      .mockResolvedValueOnce(order([parcel('packed', [{ itemId: 'i1', quantity: 1 }, { itemId: 'i2', quantity: 2 }])]))
      .mockResolvedValueOnce(order([])); // nothing boxed → cannot ship in bulk

    const { body } = await run(bulkUpdateStatus, {
      body: { orderIds: ['order-1', 'order-2'], status: 'shipped' }, user: ADMIN,
    });

    expect(body.results.successful).toHaveLength(1);
    expect(body.results.failed).toHaveLength(1);
  });
});

describe('POST /orders/bulk/status → other statuses', () => {
  it('leaves cancel untouched by the parcel logic', async () => {
    const { body } = await run(bulkUpdateStatus, {
      body: { orderIds: ['order-1'], status: 'cancelled' }, user: ADMIN,
    });

    expect(mockOrderRepo.findById).not.toHaveBeenCalled();
    expect(mockShipmentService.deliverAllOutstanding).not.toHaveBeenCalled();
    expect(body.results.successful).toHaveLength(1);
    expect(mockOrderStatusService.updateOrderStatus).toHaveBeenCalledWith(
      'order-1', 'cancelled', expect.objectContaining({ cancelledBy: 'admin', suppressStatusEmail: false }));
  });
});
