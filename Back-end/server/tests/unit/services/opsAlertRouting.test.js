/**
 * Which inbox each admin alert goes to.
 *
 * Day-to-day ORDER alerts (new paid order, customer cancellation, return requested)
 * go to OPS_NOTIFICATION_EMAILS. Money/approval/review alerts stay on
 * ADMIN_NOTIFICATION_EMAILS. With OPS unset or blank everything goes to the admin
 * list exactly as before, so no alert is dropped before the variable is set.
 */

import { jest } from '@jest/globals';

const mockOrderFindById = jest.fn();
const mockReturnFindById = jest.fn();
const mockReviewFindById = jest.fn();
const mockSendEmail = jest.fn();

/** Fake Mongoose query: chainable .populate(), awaitable to `result`. */
const query = (result) => ({
  populate() { return this; },
  then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
});

jest.unstable_mockModule('../../../repositories/orderRepository.js', () => ({ default: { findById: mockOrderFindById } }));
jest.unstable_mockModule('../../../repositories/returnRequestRepository.js', () => ({ default: { findById: mockReturnFindById } }));
jest.unstable_mockModule('../../../repositories/reviewRepository.js', () => ({ default: { findById: mockReviewFindById } }));
jest.unstable_mockModule('../../../repositories/consultationRepository.js', () => ({ default: { findById: jest.fn() } }));
jest.unstable_mockModule('../../../repositories/jobApplicationRepository.js', () => ({ default: { findById: jest.fn() } }));
jest.unstable_mockModule('../../../services/invoiceService.js', () => ({ orderNumber: () => '#ORD1' }));
jest.unstable_mockModule('../../../services/emailHandler.js', () => ({ default: { sendEmail: mockSendEmail } }));
jest.unstable_mockModule('../../../config/company.js', () => ({
  default: { name: 'Autobacs India', email: 'support@autobacsindia.com' },
}));

const {
  emailAdminOrderPlacedAlert,
  emailAdminOrderCancelledAlert,
  emailAdminReturnAlert,
  emailAdminRefundFailedAlert,
  emailAdminTeamRefundReadyAlert,
  emailAdminReturnRefundedAlert,
  emailAdminReviewAlert,
} = await import('../../../services/adminNotificationService.js');

const ADMIN = 'info@autobacsindia.com';
const OPS = 'ops@autobacsindia.com';

const order = {
  _id: '64b7f1c2a9e4d3b100ff01ab',
  totalAmount: 1000,
  status: 'cancelled',
  cancelledBy: 'customer',
  cancelledAt: new Date('2026-07-10T09:30:00Z'),
  paymentStatus: 'paid',
  refundDetails: { status: 'failed', amount: 1000, refundMethod: 'original_payment', failureReason: 'x' },
  items: [{ _id: 'i1', name: 'Brake Pads', quantity: 1, price: 1000 }],
  shippingAddress: { fullName: 'Asha', phone: '9876543210', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
  user: { _id: 'u1', name: 'Asha', email: 'asha@example.com' },
  salesUser: null,
};
const returnRequest = {
  _id: 'ret1',
  order: { orderNumber: 'AB-1' },
  user: { name: 'Asha', email: 'asha@example.com' },
  items: [{ product: { name: 'Brake Pads' }, quantity: 1, reason: 'defective' }],
  refund: { finalAmount: 1000, productValue: 1000, status: 'completed', method: 'original_payment', razorpayRefundId: 'rfnd_1' },
};
const review = {
  _id: 'rev1', rating: 4, title: 't', comment: 'c',
  product: { _id: 'p1', name: 'Brake Pads', slug: 'brake-pads' },
  user: { _id: 'u1', name: 'Asha', email: 'asha@example.com' },
};

const OPS_ALERTS = {
  'new paid order': () => emailAdminOrderPlacedAlert('o1'),
  'order cancelled': () => emailAdminOrderCancelledAlert('o1'),
  'return requested': () => emailAdminReturnAlert('ret1'),
};
const ADMIN_ALERTS = {
  'refund failed': () => emailAdminRefundFailedAlert('o1'),
  'refund ready to pay': () => emailAdminTeamRefundReadyAlert({ orderId: 'o1', itemId: 'i1' }),
  'return refunded': () => emailAdminReturnRefundedAlert('ret1'),
  'new review': () => emailAdminReviewAlert('rev1'),
};

const sentTo = () => mockSendEmail.mock.calls.map(([m]) => m.to);

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.ADMIN_NOTIFICATION_EMAIL;
  delete process.env.OPS_NOTIFICATION_EMAILS;
  delete process.env.CAREERS_NOTIFICATION_EMAILS;
  process.env.ADMIN_NOTIFICATION_EMAILS = ADMIN;
  process.env.CAREERS_FROM_EMAIL = 'careers@autobacsindia.com';
  process.env.FRONTEND_URL = 'https://autobacsindia.com';
  mockOrderFindById.mockResolvedValue(order);
  mockReturnFindById.mockReturnValue(query(returnRequest));
  mockReviewFindById.mockReturnValue(query(review));
  mockSendEmail.mockResolvedValue({ success: true });
});

afterAll(() => {
  delete process.env.OPS_NOTIFICATION_EMAILS;
  delete process.env.ADMIN_NOTIFICATION_EMAILS;
  delete process.env.CAREERS_FROM_EMAIL;
});

describe('OPS_NOTIFICATION_EMAILS unset or blank → everything stays on the admin list', () => {
  test.each(Object.keys(OPS_ALERTS))('%s (unset) → admin', async (name) => {
    expect(await OPS_ALERTS[name]()).toEqual({ status: 'sent' });
    expect(sentTo()).toEqual([ADMIN]);
  });

  test.each(Object.keys(OPS_ALERTS))('%s (blank) → admin', async (name) => {
    process.env.OPS_NOTIFICATION_EMAILS = '  ,  ';
    expect(await OPS_ALERTS[name]()).toEqual({ status: 'sent' });
    expect(sentTo()).toEqual([ADMIN]);
  });
});

describe('OPS_NOTIFICATION_EMAILS set', () => {
  beforeEach(() => { process.env.OPS_NOTIFICATION_EMAILS = OPS; });

  test.each(Object.keys(OPS_ALERTS))('%s → ops only, not admin', async (name) => {
    expect(await OPS_ALERTS[name]()).toEqual({ status: 'sent' });
    expect(sentTo()).toEqual([OPS]);
  });

  test.each(Object.keys(ADMIN_ALERTS))('%s → still admin only', async (name) => {
    expect(await ADMIN_ALERTS[name]()).toEqual({ status: 'sent' });
    expect(sentTo()).toEqual([ADMIN]);
  });

  test('trims and de-dupes (case-insensitive) the ops list', async () => {
    process.env.OPS_NOTIFICATION_EMAILS = ' ops@autobacsindia.com, owner@autobacsindia.com ,OPS@AutobacsIndia.com,';
    await emailAdminOrderPlacedAlert('o1');
    expect(sentTo()).toEqual([OPS, 'owner@autobacsindia.com']);
  });

  test('the careers mailbox is filtered out of the ops list', async () => {
    process.env.OPS_NOTIFICATION_EMAILS = 'Careers@AutobacsIndia.com, ops@autobacsindia.com';
    await emailAdminOrderPlacedAlert('o1');
    expect(sentTo()).toEqual([OPS]);
  });

  test('only the careers mailbox on the ops list → falls back to admin, never dropped', async () => {
    process.env.OPS_NOTIFICATION_EMAILS = 'careers@autobacsindia.com';
    await emailAdminOrderPlacedAlert('o1');
    expect(sentTo()).toEqual([ADMIN]);
  });

  test('a failed ops send still throws so the queue retries', async () => {
    mockSendEmail.mockResolvedValue({ success: false, error: 'boom' });
    await expect(emailAdminOrderPlacedAlert('o1')).rejects.toThrow();
  });
});
