import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ReturnPanel from './ReturnPanel';
import RaiseReturnButton from './RaiseReturnDialog';
import { tabsFor, type ReturnDetail } from './types';

const get = jest.fn();
const post = jest.fn();
const patch = jest.fn();
// jsdom cannot type into the real editor: a textarea with the same props stands in.
jest.mock('@/components/ui/RichTextBox', () => require('@/test-utils/richTextBoxMock'));
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: {
  get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: (...a: unknown[]) => patch(...a),
} }));
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
  lines: [{ key: 'l1', orderItemId: 'l1', name: 'Dash cam', quantity: 1, unitPrice: 9000, reason: 'wrong_item', reasonLabel: 'Wrong item shipped', fault: { claimed: 'ours', confirmed: null, note: null } }],
  evidence: { video: null, proofOfPurchase: null, images: [{ url: 'https://x/p.jpg' }] }, files: [],
  destinationOptions: { default: 'warehouse', suppliers: ['Ram Traders'] }, courier: null, pickup: null, pickupAttemptsList: [],
  inspection: null, rejectionReason: null, refundDetail: null, refundRoute: 'gateway', supplierClaims: [], repeatReturns: 1, timeline: [],
  can: { review: true, pickup: false, droppedAtStore: false, received: false, supplierCheck: false, inspect: false, refund: false, supplierClaims: false, supplierMoney: false },
};

beforeEach(() => { get.mockReset(); post.mockReset(); patch.mockReset(); upload.mockReset(); });

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

describe('the unboxing video', () => {
  it('staff open the uploaded video, or the Drive/YouTube link, and see when there is none', async () => {
    get.mockResolvedValue({ success: true, return: { ...base, evidence: { ...base.evidence, video: { url: 'https://signed/v.mp4' } } } });
    const first = wrap(<ReturnPanel id="r1" />);
    expect(await screen.findByRole('link', { name: 'Unboxing video' })).toHaveAttribute('href', 'https://signed/v.mp4');
    first.unmount();

    get.mockResolvedValue({ success: true, return: { ...base, evidence: { ...base.evidence, videoLink: 'https://youtu.be/abc' } } });
    const second = wrap(<ReturnPanel id="r1" />);
    const link = await screen.findByRole('link', { name: /Unboxing video \(link\)/ });
    expect(link).toHaveAttribute('href', 'https://youtu.be/abc');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    second.unmount();

    // A request from before the rule: no video, and staff are told so plainly.
    get.mockResolvedValue({ success: true, return: base });
    wrap(<ReturnPanel id="r1" />);
    expect(await screen.findByText('No unboxing video')).toBeInTheDocument();
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
    // expectedAmount is the figure on screen — a guard the server checks, never the amount it sends.
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/returns/r1/refund', { serviceLines: [{ orderItemId: 'fit' }], creditNoteNo: undefined, expectedAmount: 10200 }));
    expect(post.mock.calls.filter(([url]) => url === '/staff/returns/r1/refund')).toHaveLength(1);
  });

  it('shows Accounts when operations changed the pickup cost, and why', async () => {
    get.mockResolvedValue({ success: true, return: { ...ready, refundDetail: { status: 'pending', pickupDeduction: 0, deductionChanges: [
      { from: 500, to: 0, reason: 'Added by mistake', byName: 'Ops One', at: '2026-11-11T05:00:00Z' },
    ] } } });
    post.mockResolvedValue(preview());
    wrap(<ReturnPanel id="r1" showRefund />);
    expect(await screen.findByText(/The pickup cost was changed after inspection/)).toBeInTheDocument();
    expect(screen.getByText(/₹500 → ₹0 by Ops One.*Reason: Added by mistake/)).toBeInTheDocument();
  });

  it('a refused send (the amount moved) goes back to the first step', async () => {
    get.mockResolvedValue({ success: true, return: ready });
    post.mockImplementation((url: string) => (url.endsWith('/refund-preview')
      ? Promise.resolve(preview())
      : Promise.reject(Object.assign(new Error('The refund amount changed to ₹9,700 since you opened it'), { status: 409 }))));
    wrap(<ReturnPanel id="r1" showRefund />);
    fireEvent.click(await screen.findByRole('button', { name: /Send refund of ₹9,200/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, send ₹9,200' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Yes, send/ })).toBeNull();
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

  it('needs a photo, the unboxing video (or a Drive/YouTube link), and the unused declaration for a customer reason', async () => {
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
    expect(submit).toBeDisabled(); // every return still needs the unboxing video

    const link = screen.getByLabelText('Unboxing video link');
    fireEvent.change(link, { target: { value: 'https://vimeo.com/1' } });
    expect(screen.getByText(/Only Google Drive or YouTube links/)).toBeInTheDocument();
    expect(submit).toBeDisabled();
    fireEvent.change(link, { target: { value: 'https://drive.google.com/file/d/abc/view' } });

    fireEvent.change(screen.getByLabelText('Reason for Seat cover'), { target: { value: 'changed_mind' } });
    expect(submit).toBeDisabled(); // a customer reason needs the declaration
    fireEvent.click(screen.getByLabelText(/unused, not installed/));
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/returns', expect.objectContaining({
      orderId: 'o1', items: [{ itemId: 'l1', quantity: 1, reason: 'changed_mind' }], unusedDeclared: true,
      images: [{ publicId: 'autobacs/returns/f/photo0.jpg', provider: 'r2' }],
      videoLink: 'https://drive.google.com/file/d/abc/view',
    })));
    expect(await screen.findByText(/Return R9 raised/)).toBeInTheDocument();
  });
});

describe('editing a raised return', () => {
  const editable: ReturnDetail = {
    ...base,
    updatedAt: '2026-11-06T05:00:00.000Z',
    lines: [
      { ...base.lines[0], quantity: 2, unitPrice: 4600, name: 'Grill logo' },
      { key: 'l2', orderItemId: 'l2', name: 'Floor mat', quantity: 1, unitPrice: 1000, reason: 'wrong_item', reasonLabel: 'Wrong item shipped', fault: { claimed: 'ours', confirmed: null, note: null } },
    ],
    can: { ...base.can, review: false, edit: true, editReason: true, editRemoveLine: true },
  };

  it('sends only what changed, against the version it opened — never a price', async () => {
    get.mockResolvedValue({ success: true, return: editable });
    patch.mockResolvedValue({ success: true, return: editable });
    wrap(<ReturnPanel id="r1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Edit return/ }));
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled(); // nothing changed yet
    // Quantity can only go down: the choices stop at what was raised.
    const qty = screen.getByLabelText('How many Grill logo');
    expect([...(qty as HTMLSelectElement).options].map((o) => o.value)).toEqual(['2', '1']);
    fireEvent.change(qty, { target: { value: '1' } });
    fireEvent.click(screen.getAllByLabelText('Take this item off the return')[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff/returns/r1', {
      updatedAt: '2026-11-06T05:00:00.000Z',
      lines: [{ key: 'l1', quantity: 1 }, { key: 'l2', remove: true }],
    }));
    expect(JSON.stringify(patch.mock.calls[0][1])).not.toMatch(/price|amount/i);
  });

  it('a customer reason needs the declaration; the last photo cannot be removed', async () => {
    get.mockResolvedValue({ success: true, return: editable });
    wrap(<ReturnPanel id="r1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Edit return/ }));
    fireEvent.change(screen.getByLabelText('Reason for Grill logo'), { target: { value: 'changed_mind' } });
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/unused, not installed/));
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Remove customer photo 1' })).toBeDisabled();
  });

  it('operations corrects the pickup cost after inspection: a reason is required, only the deduction is sent', async () => {
    const inspected: ReturnDetail = {
      ...editable, status: 'received', inspection: { passed: true },
      refundDetail: { status: 'pending', pickupDeduction: 500, pickupDeductionReason: 'Delhivery DL9' },
      can: { ...editable.can, editReason: false, editRemoveLine: false, editPickupCost: true },
    };
    get.mockResolvedValue({ success: true, return: inspected });
    patch.mockResolvedValue({ success: true, return: inspected });
    wrap(<ReturnPanel id="r1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Edit return/ }));
    const cost = screen.getByLabelText('Pickup cost in rupees');
    expect(cost).toHaveValue(500);
    fireEvent.change(cost, { target: { value: '0' } });
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled(); // no reason yet
    fireEvent.change(screen.getByLabelText('Why the pickup cost is changing'), { target: { value: 'Added by mistake' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff/returns/r1', {
      updatedAt: '2026-11-06T05:00:00.000Z',
      pickupCost: { rupees: 0, reason: 'Added by mistake' },
    }));
  });

  it('hides the pickup cost from anyone who may not change it', async () => {
    get.mockResolvedValue({ success: true, return: editable });
    wrap(<ReturnPanel id="r1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Edit return/ }));
    expect(screen.queryByLabelText('Pickup cost in rupees')).toBeNull();
  });

  it('shows why it is locked once the refund is with Accounts', async () => {
    get.mockResolvedValue({ success: true, return: { ...editable, can: { ...editable.can, edit: false }, editLock: "The refund is already with Accounts — this return can't be changed now." } });
    wrap(<ReturnPanel id="r1" />);
    expect(await screen.findByText(/The refund is already with Accounts/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit return/ })).toBeNull();
  });
});
