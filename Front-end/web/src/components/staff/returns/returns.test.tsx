import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ReturnPanel from './ReturnPanel';
import RaiseReturnButton from './RaiseReturnDialog';
import { tabsFor, type ReturnDetail } from './types';

const get = jest.fn();
const post = jest.fn();
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) } }));
jest.mock('@/lib/http/tokenManager', () => ({
  tokenManager: { ensureCsrfToken: jest.fn().mockResolvedValue(undefined), getHeaders: () => ({ 'Content-Type': 'application/json' }) },
}));
const upload = jest.fn();
jest.mock('@/lib/returnUploads', () => ({
  getReturnUploadSignature: jest.fn().mockResolvedValue({ provider: 'r2', folder: 'f', uploads: [] }),
  uploadReturnFile: (...a: unknown[]) => upload(...a),
}));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href, ...p }: { children: React.ReactNode; href: string }) => <a href={href} {...p}>{children}</a> }));

const wrap = (ui: React.ReactElement) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);

const base: ReturnDetail = {
  id: 'r1', ref: 'R1', orderId: 'o1', orderNumber: 'ORD1', customer: 'Ravi',
  items: [{ name: 'Dash cam', quantity: 1, reason: 'wrong_item', reasonLabel: 'Wrong item shipped', fault: 'ours' }],
  status: 'pending', stage: 'Check 1 — evidence', origin: 'customer', destination: null, supplierName: null, pickupMode: null,
  pickupAttempts: 0, refund: { status: 'pending', amount: 0 }, claims: [], createdAt: '2026-10-30T05:00:00Z', ageDays: 0,
  problemDescription: 'Wrong model', raisedBy: null, customerContact: { name: 'Ravi', phone: '9876543210', email: '' }, seller: 'Website',
  lines: [{ orderItemId: 'l1', name: 'Dash cam', quantity: 1, unitPrice: 9000, reason: 'wrong_item', reasonLabel: 'Wrong item shipped', fault: { claimed: 'ours', confirmed: null, note: null } }],
  evidence: { video: null, proofOfPurchase: null, images: [{ url: 'https://x/p.jpg' }] }, files: [],
  destinationOptions: { default: 'warehouse', suppliers: ['Ram Traders'] }, courier: null, pickup: null, pickupAttemptsList: [],
  inspection: null, rejectionReason: null, refundDetail: null, refundRoute: 'gateway', supplierClaims: [], repeatReturns: 1, timeline: [],
  can: { review: true, pickup: false, droppedAtStore: false, received: false, supplierCheck: false, inspect: false, refund: false, supplierClaims: false, supplierMoney: false },
};

beforeEach(() => { get.mockReset(); post.mockReset(); upload.mockReset(); });

describe('tabs per team', () => {
  it('gives each team the steps it owns, and never the others', () => {
    const keys = (who: Parameters<typeof tabsFor>[0]) => tabsFor(who).map((t) => t.key);
    expect(keys({ team: 'operations', isHead: false, canSell: false, isAdmin: false })).toEqual(['review', 'pickup', 'inspect', 'all']);
    expect(keys({ team: 'procurement', isHead: false, canSell: false, isAdmin: false })).toEqual(['supplier_pickup', 'supplier', 'owed', 'all']);
    expect(keys({ team: 'accounts', isHead: false, canSell: false, isAdmin: false })).toEqual(['owed', 'all']);
    expect(keys({ team: 'sales', isHead: false, canSell: true, isAdmin: false })).toEqual(['mine']);
    expect(keys({ team: 'sales', isHead: true, canSell: true, isAdmin: false })).toEqual(['mine', 'all']);
    expect(keys({ team: 'marketing', isHead: false, canSell: false, isAdmin: false })).toEqual([]);
  });
});

describe('check 1', () => {
  it('approves with the confirmed fault and the pre-filled supplier destination', async () => {
    get.mockResolvedValue({ success: true, return: base });
    post.mockResolvedValue({ success: true, return: { ...base, status: 'approved', can: { ...base.can, review: false } } });
    wrap(<ReturnPanel id="r1" />);
    expect(await screen.findByText(/2? ?returns? from this customer|Straight to the supplier: Ram Traders/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Straight to the supplier: Ram Traders/));
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/returns/r1/review', expect.objectContaining({
      decision: 'approve',
      faults: { l1: { confirmed: 'ours', note: '' } },
      destination: { kind: 'supplier', supplierName: 'Ram Traders' },
    })));
  });

  it('asks why when the fault is changed, and needs a reason to reject', async () => {
    get.mockResolvedValue({ success: true, return: base });
    wrap(<ReturnPanel id="r1" />);
    fireEvent.click(await screen.findByLabelText("Customer's reason"));
    expect(screen.getByPlaceholderText(/Why is it different/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Reject/ }));
    expect(screen.getByRole('button', { name: 'Reject return' })).toBeDisabled();
  });
});

describe('check 2', () => {
  it('needs a photo, a note and what happens to the item before it can be saved', async () => {
    get.mockResolvedValue({ success: true, return: { ...base, status: 'received', can: { ...base.can, review: false, inspect: true } } });
    wrap(<ReturnPanel id="r1" />);
    const save = await screen.findByRole('button', { name: 'Save inspection' });
    fireEvent.click(screen.getAllByLabelText('Passed')[0]);
    fireEvent.change(screen.getByPlaceholderText('What you found'), { target: { value: 'Unused' } });
    fireEvent.change(screen.getByLabelText('What happens to the item'), { target: { value: 'resell' } });
    expect(save).toBeDisabled(); // still no photo
  });
});

describe('the refund box (accounts)', () => {
  const ready = {
    ...base, status: 'received' as const, inspection: { passed: true },
    can: { ...base.can, review: false, refund: true },
  };
  const preview = (over = {}) => ({
    success: true,
    preview: {
      breakdown: { goodsGross: 9000, goodsNet: 9000, discountShare: 0, shippingShare: 200, service: 0, pickupDeduction: 0, restocking: 0, total: 9200 },
      refundNow: 9200, orderTotal: 10200, alreadyRefunded: 0, maxRefundable: 10200, hasOurFault: true, hasCustomerFault: false,
      fullRefundOnly: false, paidBy: null, serviceLineOptions: [{ orderItemId: 'fit', name: 'Installation', quantity: 1, netPaid: 1000, alreadyRefunded: false }],
      canSend: true, limit: 25000, ...over,
    },
  });

  it('shows the server figure and sends only choices — never an amount', async () => {
    get.mockResolvedValue({ success: true, return: ready });
    post.mockImplementation((url: string, body: { serviceLines?: unknown[] }) => {
      if (url.endsWith('/refund-preview')) return Promise.resolve(preview(body.serviceLines?.length ? { refundNow: 10200, breakdown: { ...preview().preview.breakdown, service: 1000, total: 10200 } } : {}));
      return Promise.resolve({ success: true });
    });
    wrap(<ReturnPanel id="r1" showRefund />);
    expect(await screen.findByRole('button', { name: /Send refund of ₹9,200/ })).toBeEnabled();
    fireEvent.click(screen.getByLabelText(/Installation — paid/));
    fireEvent.click(await screen.findByRole('button', { name: /Send refund of ₹10,200/ }));
    // The first press only asks: nothing is paid until the amount is confirmed.
    expect(screen.getByText(/Send ₹10,200 to the customer's original payment\? This cannot be undone/)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalledWith('/staff/returns/r1/refund', expect.anything());
    fireEvent.click(screen.getByRole('button', { name: 'Yes, send ₹10,200' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/returns/r1/refund', { serviceLines: [{ orderItemId: 'fit' }], creditNoteNo: undefined }));
    expect(post.mock.calls.filter(([url]) => url === '/staff/returns/r1/refund')).toHaveLength(1);
  });

  it('changing what is ticked drops back to the first step, so the confirmed amount is the one on screen', async () => {
    get.mockResolvedValue({ success: true, return: ready });
    post.mockImplementation((url: string, body: { serviceLines?: unknown[] }) => {
      if (url.endsWith('/refund-preview')) return Promise.resolve(preview(body.serviceLines?.length ? { refundNow: 10200, breakdown: { ...preview().preview.breakdown, service: 1000, total: 10200 } } : {}));
      return Promise.resolve({ success: true });
    });
    wrap(<ReturnPanel id="r1" showRefund />);
    fireEvent.click(await screen.findByRole('button', { name: /Send refund of ₹9,200/ }));
    expect(screen.getByRole('button', { name: 'Yes, send ₹9,200' })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Installation — paid/));
    expect(screen.queryByRole('button', { name: /Yes, send/ })).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Send refund of ₹10,200/ })).toBeEnabled();
    expect(post.mock.calls.filter(([url]) => url === '/staff/returns/r1/refund')).toHaveLength(0);
  });

  it('above the accounts limit, says who sends it and blocks the button', async () => {
    get.mockResolvedValue({ success: true, return: ready });
    post.mockResolvedValue(preview({ refundNow: 30000, canSend: false }));
    wrap(<ReturnPanel id="r1" showRefund />);
    expect(await screen.findByText(/sent by the accounts head or an admin/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send refund/ })).toBeDisabled();
  });

  it('a bank-transfer order is paid back by an admin — no button for accounts', async () => {
    get.mockResolvedValue({ success: true, return: { ...ready, refundRoute: 'offline' } });
    wrap(<ReturnPanel id="r1" showRefund />);
    expect(await screen.findByText(/paid by an admin/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Send refund/ })).not.toBeInTheDocument();
  });
});

describe('supplier money', () => {
  it('accounts confirms it once with the UTR', async () => {
    const claim = {
      _id: 'c1', status: 'promised' as const, supplierName: 'Ram Traders',
      settlement: { kind: 'credit_note' as const, amountPaise: 700000, reference: 'CN-1', promisedAt: '2026-10-30T05:00:00Z' },
    };
    get.mockResolvedValue({ success: true, return: { ...base, status: 'refunded', inspection: { passed: true }, supplierClaims: [claim], can: { ...base.can, review: false, supplierMoney: true } } });
    post.mockResolvedValue({ success: true, return: base });
    wrap(<ReturnPanel id="r1" />);
    const confirm = await screen.findByRole('button', { name: 'Confirm received' });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Bank reference (UTR)'), { target: { value: 'UTR99' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/returns/r1/claims/c1/received', { method: 'bank', utr: 'UTR99', deductedFromRef: undefined }));
  });
});

describe('raise a return', () => {
  const options = {
    success: true,
    options: {
      orderId: 'o1', orderNumber: 'ORD1', customer: 'Ravi', paid: true, repeatReturns: 0,
      lines: [{
        itemId: 'l1', name: 'Seat cover', unitPrice: 5000, quantity: 1, returnableQuantity: 1, deliveredAt: new Date().toISOString(),
        windowEnds: { ours: new Date(Date.now() + 6 * 864e5).toISOString(), customer: new Date(Date.now() + 3 * 864e5).toISOString() },
        returnableForCustomerReason: true,
      }],
    },
  };

  it('needs a photo, a video for transit damage, and the unused declaration for a customer reason', async () => {
    get.mockResolvedValue(options);
    upload.mockResolvedValue({ publicId: 'autobacs/returns/f/photo0.jpg', provider: 'r2', resourceType: 'image' });
    post.mockResolvedValue({ success: true, return: { id: 'r9', ref: 'R9' } });
    wrap(<RaiseReturnButton orderId="o1" />);
    fireEvent.click(screen.getByRole('button', { name: /Raise return/ }));
    fireEvent.click(await screen.findByLabelText(/Seat cover/));
    fireEvent.change(screen.getByLabelText('Reason for Seat cover'), { target: { value: 'transit_damage' } });
    fireEvent.change(screen.getByPlaceholderText(/customer's words/), { target: { value: 'Torn on arrival' } });
    // The dialog's own submit button (the page button that opened it has the same words).
    const submit = screen.getAllByRole('button', { name: 'Raise return' }).at(-1)!;
    expect(submit).toBeDisabled();

    const photoInput = screen.getByText('Add photo').querySelector('input') as HTMLInputElement;
    fireEvent.change(photoInput, { target: { files: [new File(['x'], 'p.jpg', { type: 'image/jpeg' })] } });
    await waitFor(() => expect(upload).toHaveBeenCalled());
    expect(submit).toBeDisabled(); // transit damage still needs the video

    fireEvent.change(screen.getByLabelText('Reason for Seat cover'), { target: { value: 'changed_mind' } });
    expect(submit).toBeDisabled(); // a customer reason needs the declaration
    fireEvent.click(screen.getByLabelText(/unused, not installed/));
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/returns', expect.objectContaining({
      orderId: 'o1', items: [{ itemId: 'l1', quantity: 1, reason: 'changed_mind' }], unusedDeclared: true,
      images: [{ publicId: 'autobacs/returns/f/photo0.jpg', provider: 'r2' }],
    })));
    expect(await screen.findByText(/Return R9 raised/)).toBeInTheDocument();
  });
});
