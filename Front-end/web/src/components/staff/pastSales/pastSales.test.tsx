/**
 * Past (offline) sales screens. The server owns every rule (who may edit, what is
 * a duplicate, the money); these prove the screens send what was typed, show what
 * the server says, and only offer what the viewer may do.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PastSaleForm from './PastSaleForm';
import PastSaleUpload from './PastSaleUpload';
import PastSalesPage from './PastSalesPage';
import CustomerPastSales from './CustomerPastSales';
import { viewerOf, type PastSale, type UploadResult } from './types';

const get = jest.fn();
const post = jest.fn();
const put = jest.fn();
const del = jest.fn();
const postForm = jest.fn();
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: {
    get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a),
    put: (...a: unknown[]) => put(...a), delete: (...a: unknown[]) => del(...a),
  },
}));
jest.mock('@/components/payments/api', () => ({ postForm: (...a: unknown[]) => postForm(...a) }));
let mockUser: { role: string; staff: { team: string; isHead: boolean } | null } = { role: 'staff', staff: { team: 'sales', isHead: false } };
jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));

const wrap = (ui: React.ReactNode) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);

const SALE = (extra: Partial<PastSale> = {}): PastSale => ({
  id: 's1', saleDate: '2024-03-14', invoiceNo: 'AB-1',
  customer: { name: 'Arun Kumar', phone: '9876543210', email: '', city: 'Kochi', state: '' },
  business: null, vehicle: '', channel: 'store',
  items: [{ product: null, name: 'Mats', quantity: 1, price: 6500 }],
  itemsTotal: 6500, discount: 0, gstAmount: null, totalAmount: 6500, amountMismatch: false,
  paymentMethod: 'upi', notes: '', soldBy: { id: 'u1', name: 'Sam' }, enteredBy: 'Sam',
  enteredAt: '2026-10-29T10:00:00.000Z', batchId: null, deleted: null, version: '2026-10-29T10:00:00.000Z',
  can: { edit: true, delete: false, restore: false },
  ...extra,
});

const lead = { manage: false, seesAll: false };
const accounts = { manage: true, seesAll: true };

beforeEach(() => {
  get.mockReset(); post.mockReset(); put.mockReset(); del.mockReset(); postForm.mockReset();
  window.confirm = jest.fn(() => true);
  window.scrollTo = jest.fn();
  mockUser = { role: 'staff', staff: { team: 'sales', isHead: false } };
});

describe('viewerOf', () => {
  it('accounts and the admin manage; the GTM head sees all; a lead sees their own', () => {
    expect(viewerOf({ role: 'admin', staff: null })).toEqual({ manage: true, seesAll: true });
    expect(viewerOf({ role: 'staff', staff: { team: 'accounts', isHead: false } })).toEqual({ manage: true, seesAll: true });
    expect(viewerOf({ role: 'staff', staff: { team: 'sales', isHead: true } })).toEqual({ manage: false, seesAll: true });
    expect(viewerOf({ role: 'staff', staff: { team: 'sales', isHead: false } })).toEqual({ manage: false, seesAll: false });
    expect(viewerOf(null)).toEqual({ manage: false, seesAll: false });
  });
});

function fillRequired() {
  fireEvent.change(screen.getByLabelText('Sale date *'), { target: { value: '2024-03-14' } });
  fireEvent.change(screen.getByLabelText('Customer name *'), { target: { value: 'Arun Kumar' } });
  fireEvent.change(screen.getByLabelText('Item name'), { target: { value: 'Mats' } });
  fireEvent.change(screen.getByLabelText('Price per unit, item 1'), { target: { value: '6500' } });
  fireEvent.change(screen.getByLabelText('Total paid ₹ *'), { target: { value: '6000' } });
  fireEvent.change(screen.getByLabelText('Payment method *'), { target: { value: 'cash' } });
}

describe('the form', () => {
  it('sends exactly what was typed (no salesman for a lead) and warns when the total does not add up', async () => {
    post.mockResolvedValue({ sale: SALE(), warnings: ['Saved as written on the bill.'] });
    const onDone = jest.fn();
    wrap(<PastSaleForm viewer={lead} onDone={onDone} onCancel={() => {}} />);
    expect(screen.queryByLabelText('Sold by')).toBeNull();
    fillRequired();
    expect(screen.getByText(/does not match the total paid/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save sale' }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith(['Saved as written on the bill.']));
    const [url, body] = post.mock.calls[0];
    expect(url).toBe('/staff/past-sales');
    expect(body).toMatchObject({
      saleDate: '2024-03-14', customer: { name: 'Arun Kumar' },
      items: [{ product: null, name: 'Mats', quantity: '1', price: '6500' }],
      totalAmount: '6000', paymentMethod: 'cash',
    });
    expect(body).not.toHaveProperty('salesUserId');
    expect(body).not.toHaveProperty('allowDuplicate');
  });

  it('a duplicate offers "Save anyway", which resends with allowDuplicate', async () => {
    post
      .mockRejectedValueOnce({ rawData: { message: 'This sale is already entered (2024-03-14, Arun). If it really is a second sale, save it anyway.' } })
      .mockResolvedValueOnce({ sale: SALE(), warnings: [] });
    const onDone = jest.fn();
    wrap(<PastSaleForm viewer={lead} onDone={onDone} onCancel={() => {}} />);
    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: 'Save sale' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save anyway' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(post.mock.calls[1][1]).toMatchObject({ allowDuplicate: true });
  });

  it('accounts picks the salesman; an edit sends the version it was opened at', async () => {
    get.mockResolvedValue({ sellers: [{ id: 'u1', name: 'Sam', current: true }, { id: 'u9', name: 'Old Raj', current: false }] });
    put.mockResolvedValue({ sale: SALE(), warnings: [] });
    wrap(<PastSaleForm sale={SALE()} viewer={accounts} onDone={() => {}} onCancel={() => {}} />);
    const sold = screen.getByLabelText('Sold by');
    await screen.findByRole('option', { name: 'Old Raj (former)' });
    fireEvent.change(sold, { target: { value: 'u9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(put.mock.calls[0][0]).toBe('/staff/past-sales/s1');
    expect(put.mock.calls[0][1]).toMatchObject({ salesUserId: 'u9', version: '2026-10-29T10:00:00.000Z', totalAmount: '6500' });
  });
});

describe('the upload', () => {
  const preview: UploadResult = {
    sales: [
      { rows: [2, 3], status: 'ready', reasons: [], warnings: [], saleDate: '2024-03-14', invoiceNo: 'AB-1', customer: 'Arun', items: 2, totalAmount: 7400 },
      { rows: [4], status: 'error', reasons: ['Enter the customer name.'], warnings: [], saleDate: '2024-03-16', invoiceNo: '', customer: '', items: 1, totalAmount: null },
    ],
    counts: { rows: 3, sales: 2, ready: 1, duplicates: 0, errors: 1 },
    readyValue: 7400,
  };

  it('checks first (saves nothing), then adds only the ready sales', async () => {
    postForm.mockResolvedValueOnce(preview).mockResolvedValueOnce({
      ...preview, sales: [{ ...preview.sales[0], status: 'imported' }, preview.sales[1]],
      counts: { rows: 3, sales: 2, imported: 1, duplicates: 0, errors: 1 }, importedValue: 7400, batchId: 'abcdef0123456789abcdef01',
    });
    wrap(<PastSaleUpload viewer={lead} onClose={() => {}} />);
    const file = new File(['csv'], 'sales.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByLabelText('CSV file'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: /Check file/ }));

    expect(await screen.findByText('Enter the customer name.')).toBeInTheDocument();
    expect(postForm.mock.calls[0][0]).toBe('/staff/past-sales/upload/preview');
    expect((postForm.mock.calls[0][1] as FormData).get('file')).toBe(file);
    expect((postForm.mock.calls[0][1] as FormData).has('salesUserId')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Add 1 sale' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Added 1 sale');
    expect(postForm.mock.calls[1][0]).toBe('/staff/past-sales/upload');
    // A lead cannot undo an upload — only accounts / admin.
    expect(screen.queryByRole('button', { name: 'Undo this upload' })).toBeNull();
  });

  it('accounts can undo the whole upload', async () => {
    get.mockResolvedValue({ sellers: [] });
    postForm.mockResolvedValueOnce(preview).mockResolvedValueOnce({
      ...preview, counts: { rows: 3, sales: 2, imported: 1, duplicates: 0, errors: 1 }, importedValue: 7400, batchId: 'abcdef0123456789abcdef01',
    });
    del.mockResolvedValue({ deleted: 1 });
    wrap(<PastSaleUpload viewer={accounts} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('CSV file'), { target: { files: [new File(['csv'], 's.csv')] } });
    fireEvent.click(screen.getByRole('button', { name: /Check file/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add 1 sale' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Undo this upload' }));
    expect(await screen.findByText('Upload undone: 1 sales deleted.')).toBeInTheDocument();
    expect(del).toHaveBeenCalledWith('/staff/past-sales/uploads/abcdef0123456789abcdef01');
    expect((postForm.mock.calls[0][1] as FormData).get('salesUserId')).toBe('none');
  });

  it('a file the server cannot read shows its words', async () => {
    postForm.mockRejectedValue({ rawData: { message: 'These columns are missing: Item.' } });
    wrap(<PastSaleUpload viewer={lead} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('CSV file'), { target: { files: [new File(['x'], 'x.csv')] } });
    fireEvent.click(screen.getByRole('button', { name: /Check file/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('These columns are missing: Item.');
  });
});

describe('the page', () => {
  const route = (sales: PastSale[]) => (url: string) => {
    if (url.startsWith('/staff/past-sales/totals')) return Promise.resolve({ sellers: [{ id: 'u1', name: 'Sam', sales: sales.length, value: 6500 }], total: { sales: sales.length, value: 6500 } });
    if (url.startsWith('/staff/past-sales/sellers')) return Promise.resolve({ sellers: [] });
    return Promise.resolve({ sales, nextCursor: null });
  };

  it('a lead sees their total and their sales, can edit but not delete', async () => {
    get.mockImplementation(route([SALE()]));
    wrap(<PastSalesPage />);
    const row = (await screen.findByText(/Arun Kumar · ₹6,500/)).closest('li') as HTMLElement;
    expect(within(row).getByRole('button', { name: /Edit/ })).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /Delete/ })).toBeNull();
    expect(screen.getByText('My past sales')).toBeInTheDocument();
    expect(screen.queryByLabelText('Show deleted')).toBeNull();
  });

  it('accounts deletes (after confirming) and sees the per-salesman totals', async () => {
    mockUser = { role: 'staff', staff: { team: 'accounts', isHead: false } };
    get.mockImplementation(route([SALE({ can: { edit: true, delete: true, restore: false } })]));
    del.mockResolvedValue({ sale: SALE() });
    wrap(<PastSalesPage />);
    const row = (await screen.findByText(/Arun Kumar · ₹6,500/)).closest('li') as HTMLElement;
    expect(await screen.findByRole('table')).toHaveTextContent('Sam');
    fireEvent.click(within(row).getByRole('button', { name: /Delete/ }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/staff/past-sales/s1'));
    expect(window.confirm).toHaveBeenCalled();
  });

  it('search is sent to the server', async () => {
    get.mockImplementation(route([]));
    wrap(<PastSalesPage />);
    expect(await screen.findByText('No past sales yet. Add one, or upload a sheet.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: '98765 43210' } });
    await waitFor(() => expect(get.mock.calls.some(([u]) => String(u).includes('q=98765+43210'))).toBe(true));
  });
});

describe('customer history on the lead page', () => {
  it('lists past purchases, and nothing when there are none', () => {
    const { container, rerender } = render(<CustomerPastSales sales={[]} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<CustomerPastSales sales={[{ id: 'a', saleDate: '2023-05-01', invoiceNo: 'A1', items: [{ name: 'Mats', quantity: 2 }], totalAmount: 13000, paymentMethod: 'cash', channel: 'store', soldBy: 'Sam' }]} />);
    expect(screen.getByRole('region', { name: 'Bought before the website' })).toHaveTextContent('Mats × 2 · Cash · sold by Sam');
  });
});
