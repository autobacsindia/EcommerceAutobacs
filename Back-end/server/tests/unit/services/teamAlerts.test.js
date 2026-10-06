/**
 * Team workflow emails (adminNotificationService): who gets each one.
 * Rule: the team heads who own the step, plus the sales person on their own orders;
 * website orders (no sales person) go to the sales heads. Never throws.
 */

import { jest } from '@jest/globals';

const mockOrderFindById = jest.fn();
const mockFindActiveStaff = jest.fn();
const mockSendEmail = jest.fn();

jest.unstable_mockModule('../../../repositories/orderRepository.js', () => ({ default: { findById: mockOrderFindById } }));
jest.unstable_mockModule('../../../repositories/userRepository.js', () => ({ default: { findActiveStaff: mockFindActiveStaff } }));
jest.unstable_mockModule('../../../repositories/reviewRepository.js', () => ({ default: {} }));
jest.unstable_mockModule('../../../repositories/consultationRepository.js', () => ({ default: {} }));
jest.unstable_mockModule('../../../services/invoiceService.js', () => ({ orderNumber: () => '#ORD1' }));
jest.unstable_mockModule('../../../services/emailHandler.js', () => ({ default: { sendEmail: mockSendEmail } }));
jest.unstable_mockModule('../../../config/company.js', () => ({ default: { name: 'Autobacs India', email: 'support@autobacsindia.com' } }));

const {
  emailStaffSalesPaidAlert,
  emailTeamShippedAlert,
  emailTeamOutOfStockAlert,
  emailTeamRefundRequestedAlert,
  emailAdminTeamRefundReadyAlert,
} = await import('../../../services/adminNotificationService.js');

const person = (email, team, isHead = false) => ({ email, name: email.split('@')[0], role: 'staff', staff: { team, isHead, active: true } });
const STAFF = {
  accounts: [person('acc-head@x.com', 'accounts', true), person('acc@x.com', 'accounts')],
  procurement: [person('proc-head@x.com', 'procurement', true), person('proc@x.com', 'procurement')],
  operations: [person('ops-head@x.com', 'operations', true), person('ops@x.com', 'operations')],
  sales: [person('sales-head@x.com', 'sales', true), person('rep@x.com', 'sales')],
};

const order = (over = {}) => ({
  _id: 'o1',
  items: [{ _id: 'i1', name: 'Snorkel', quantity: 1 }],
  shippingAddress: { fullName: 'Ravi', phone: '9876543210', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
  totalAmount: 30000,
  shipments: [{ _id: 's1', trackingNumber: 'DL1', carrier: { name: 'Delhivery' }, lines: [{ itemId: 'i1', quantity: 1 }] }],
  salesUser: null,
  ...over,
});

const recipients = () => mockSendEmail.mock.calls.map(([m]) => m.to).sort();

beforeEach(() => {
  jest.clearAllMocks();
  process.env.FRONTEND_URL = 'https://autobacsindia.com';
  delete process.env.ADMIN_NOTIFICATION_EMAILS;
  mockFindActiveStaff.mockImplementation(async (team) => STAFF[team] || []);
  mockSendEmail.mockResolvedValue({ success: true });
});

describe('paid alert', () => {
  it('goes to the accounts, procurement and operations heads for a website order', async () => {
    mockOrderFindById.mockResolvedValue(order());
    await emailStaffSalesPaidAlert('o1');
    expect(recipients()).toEqual(['acc-head@x.com', 'ops-head@x.com', 'proc-head@x.com']);
    expect(mockSendEmail.mock.calls[0][0].subject).toMatch(/^Paid: website order #ORD1/);
  });

  it('adds the sales person for their own order', async () => {
    mockOrderFindById.mockResolvedValue(order({ salesUser: person('rep@x.com', 'sales') }));
    await emailStaffSalesPaidAlert('o1');
    expect(recipients()).toEqual(['acc-head@x.com', 'ops-head@x.com', 'proc-head@x.com', 'rep@x.com']);
    expect(mockSendEmail.mock.calls[0][0].subject).toMatch(/^Paid: sales order/);
  });
});

describe('shipped alert', () => {
  it('tells the sales person and the operations heads, with courier and tracking', async () => {
    mockOrderFindById.mockResolvedValue(order({ salesUser: person('rep@x.com', 'sales') }));
    await emailTeamShippedAlert({ orderId: 'o1', shipmentId: 's1' });
    expect(recipients()).toEqual(['ops-head@x.com', 'rep@x.com']);
    const { subject, text } = mockSendEmail.mock.calls[0][0];
    expect(subject).toBe('Shipped: #ORD1 — DL1');
    expect(text).toMatch(/Delhivery/);
  });

  it('uses the sales heads for a website order', async () => {
    mockOrderFindById.mockResolvedValue(order());
    await emailTeamShippedAlert({ orderId: 'o1', shipmentId: 's1' });
    expect(recipients()).toEqual(['ops-head@x.com', 'sales-head@x.com']);
  });

  it('falls back to the sales heads when the seller has left', async () => {
    mockOrderFindById.mockResolvedValue(order({ salesUser: { ...person('gone@x.com', 'sales'), staff: { team: 'sales', active: false } } }));
    await emailTeamShippedAlert({ orderId: 'o1', shipmentId: 's1' });
    expect(recipients()).toEqual(['ops-head@x.com', 'sales-head@x.com']);
  });
});

describe('out-of-stock and refund alerts', () => {
  it('out of stock → the sales side only', async () => {
    mockOrderFindById.mockResolvedValue(order({ salesUser: person('rep@x.com', 'sales') }));
    await emailTeamOutOfStockAlert({ orderId: 'o1', itemId: 'i1' });
    expect(recipients()).toEqual(['rep@x.com']);
    expect(mockSendEmail.mock.calls[0][0].text).toMatch(/Snorkel × 1/);
  });

  it('refund requested → the accounts heads', async () => {
    mockOrderFindById.mockResolvedValue(order());
    await emailTeamRefundRequestedAlert({ orderId: 'o1', itemId: 'i1' });
    expect(recipients()).toEqual(['acc-head@x.com']);
  });

  it('refund approved → the admin inbox', async () => {
    process.env.ADMIN_NOTIFICATION_EMAILS = 'admin@autobacsindia.com';
    mockOrderFindById.mockResolvedValue(order());
    await emailAdminTeamRefundReadyAlert({ orderId: 'o1', itemId: 'i1' });
    expect(recipients()).toEqual(['admin@autobacsindia.com']);
    expect(mockSendEmail.mock.calls[0][0].html).toMatch(/REFUND APPROVED/);
  });
});

describe('robustness', () => {
  it('keeps going when one inbox fails, and never throws', async () => {
    mockOrderFindById.mockResolvedValue(order());
    mockSendEmail.mockRejectedValueOnce(new Error('bounce')).mockResolvedValue({ success: true });
    await expect(emailStaffSalesPaidAlert('o1')).resolves.toEqual({ status: 'sent' });
    expect(mockSendEmail).toHaveBeenCalledTimes(3);
  });

  it('reports no recipients rather than failing when a team has nobody yet', async () => {
    mockFindActiveStaff.mockResolvedValue([]);
    mockOrderFindById.mockResolvedValue(order());
    await expect(emailTeamRefundRequestedAlert({ orderId: 'o1', itemId: 'i1' })).resolves.toEqual({ status: 'no-recipients' });
  });

  it('ignores an order or parcel that no longer exists', async () => {
    mockOrderFindById.mockResolvedValue(null);
    await expect(emailTeamShippedAlert({ orderId: 'x', shipmentId: 's1' })).resolves.toEqual({ status: 'not-found' });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});
