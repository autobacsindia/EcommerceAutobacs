/**
 * Autobacs Partner — procurement screens.
 *
 *   - the price box shows cost, GST, margin and the suggested price (₹1,800 + 18% at 30% → ₹3,035)
 *   - below cost: an error, and the price can never be sent
 *   - below the floor: only with "sell below the floor" ticked and a reason
 *   - the review screen approves as a new product with the rev it showed, the
 *     edited form and the price; a supplier edit since (409) offers a reload
 *   - linking sends the picked product; approving a supplier links the picked one
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import PriceBox, { priceSendable, priceState, type PriceBoxValue } from './PriceBox';
import Listings from './Listings';
import { ApproveBox } from './Accounts';
import { marginOf, ruleFor, suggestPrice, type AccountDetail, type ListingDetail } from './api';

const get = jest.fn();
const post = jest.fn();
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), put: jest.fn(), delete: jest.fn() },
}));
jest.mock('@/hooks/queries/useCategories', () => ({
  useCategories: () => ({ data: [{ _id: 'cat1', name: 'Wipers' }, { _id: 'cat2', name: 'Lights' }] }),
}));

const wrap = (ui: React.ReactElement) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);
const RULE = { targetBp: 3000, floorBp: 1000 };

function Box({ initial = '' }: { initial?: string }) {
  const [v, setV] = useState<PriceBoxValue>({ price: initial, override: false, reason: '' });
  const s = priceState(180000, 18, RULE, v.price);
  return (
    <>
      <PriceBox costPaise={180000} gstPct={18} rule={RULE} value={v} onChange={setV} />
      <span data-testid="sendable">{String(priceSendable(s, v))}</span>
    </>
  );
}

describe('price maths (mirrors the server)', () => {
  test('₹1,800 + 18% GST at 30% → ₹3,035; margins round down', () => {
    expect(suggestPrice(180000, 18, 3000)).toBe(3035);
    expect(marginOf(180000, 18, 3035)).toBeGreaterThanOrEqual(3000);
    expect(marginOf(180000, 18, 2000)).toBeLessThan(0);
  });
  test('the rule follows category → default → built-in', () => {
    const rules = {
      builtIn: { targetBp: 3000, floorBp: 1000 },
      default: { key: 'default', categoryId: null, categoryName: '', targetBp: 2500, floorBp: 800, updatedByName: '', updatedAt: null },
      categories: [{ key: 'category:cat2', categoryId: 'cat2', categoryName: 'Lights', targetBp: 4000, floorBp: 1500, updatedByName: '', updatedAt: null }],
    };
    expect(ruleFor(rules, ['cat2'])).toMatchObject({ targetBp: 4000 });
    expect(ruleFor(rules, ['cat1'])).toMatchObject({ targetBp: 2500 });
    expect(ruleFor({ ...rules, default: null }, [])).toMatchObject({ targetBp: 3000, source: 'built-in' });
  });
});

describe('PriceBox', () => {
  test('shows the cost, GST and suggestion; "use suggested" fills it in with the margin', () => {
    render(<Box />);
    expect(screen.getByTestId('cost')).toHaveTextContent('₹1,800');
    expect(screen.getByText('18%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /use suggested ₹3,035/i }));
    expect(screen.getByRole('textbox')).toHaveValue('3035');
    expect(screen.getByTestId('margin')).toHaveTextContent('30%');
    expect(screen.getByTestId('sendable')).toHaveTextContent('true');
  });

  test('below cost: error, never sendable — not even with an override', () => {
    render(<Box initial="2000" />);
    expect(screen.getByRole('alert')).toHaveTextContent(/below what the supplier charges/i);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByTestId('sendable')).toHaveTextContent('false');
  });

  test('below the floor: needs the tick AND a reason', () => {
    render(<Box initial="2200" />);
    expect(screen.getByRole('alert')).toHaveTextContent(/lowest allowed margin/i);
    expect(screen.getByTestId('sendable')).toHaveTextContent('false');
    fireEvent.click(screen.getByRole('checkbox', { name: /sell below the floor/i }));
    expect(screen.getByTestId('sendable')).toHaveTextContent('false');
    fireEvent.change(screen.getByPlaceholderText(/match amazon/i), { target: { value: 'Match competitor' } });
    expect(screen.getByTestId('sendable')).toHaveTextContent('true');
  });
});

const LISTING: ListingDetail = {
  id: 'l1', companyName: 'Acme Parts', status: 'submitted', rev: 4, title: 'Bosch wiper 24', brand: 'Bosch', partNumber: 'AP24U',
  costPaise: 180000, gstPct: 18, availability: 'low', imageCount: 2, submittedAt: '2026-11-20T06:00:00.000Z', productId: null, editedSinceLive: false,
  supplier: { id: 'a1', companyName: 'Acme Parts', status: 'approved', city: 'Kochi', phone: '98' },
  description: 'Flat blade that fits most hooks.', fits: 'Creta', categoryHint: 'Wipers', specs: [{ label: 'Length', value: '24 in' }],
  images: [{ index: 0, contentType: 'image/jpeg' }, { index: 1, contentType: 'image/jpeg' }], dispatchDays: 2, availabilityAt: null,
  reviewNote: '', reviewedByName: '', drivesStock: false, product: null,
  duplicates: [], pricing: { costPaise: 180000, gstPct: 18, rule: { targetBp: 3000, floorBp: 1000, source: 'built-in' }, suggestedPrice: 3035 },
};
const RULES = { builtIn: { targetBp: 3000, floorBp: 1000 }, default: null, categories: [] };

describe('listing review', () => {
  beforeEach(() => {
    get.mockImplementation((url: string) => {
      if (url.includes('/margin-rules')) return Promise.resolve({ rules: RULES });
      if (url.includes('/listings/l1')) return Promise.resolve({ listing: LISTING });
      return Promise.reject(new Error(`unexpected ${url}`));
    });
  });

  test('approve as new: sends the rev it showed, the edited form and the price', async () => {
    post.mockResolvedValue({ listing: { ...LISTING, status: 'live' }, product: { id: 'p1', name: 'Bosch Aerotwin 24', price: 3035 }, created: true });
    wrap(<Listings openId="l1" onOpen={() => {}} />);
    const approve = await screen.findByRole('button', { name: /approve as new product/i });
    expect(approve).toBeDisabled(); // no category, no price yet
    fireEvent.change(screen.getByLabelText('Product name'), { target: { value: 'Bosch Aerotwin 24' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), { target: { value: 'cat1' } });
    fireEvent.click(screen.getByRole('button', { name: /use suggested/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /photo 1/i })); // untick the first photo
    expect(approve).toBeEnabled();
    fireEvent.click(approve);
    await waitFor(() => expect(post).toHaveBeenCalled());
    const [url, body] = post.mock.calls[0];
    expect(url).toBe('/procurement/partners/listings/l1/approve-new');
    expect(body).toMatchObject({
      rev: 4, price: 3035, keepHidden: false, drivesStock: true, imageIndexes: [1],
      product: { name: 'Bosch Aerotwin 24', categories: ['cat1'], brand: 'Bosch', sku: 'AP24U' },
    });
    expect(body).not.toHaveProperty('override');
    expect(await screen.findByRole('status')).toHaveTextContent(/live on the website at ₹3,035/i);
  });

  test('a supplier edit since loading (409) says so and offers their latest version', async () => {
    post.mockRejectedValue({ rawData: { message: 'The supplier changed this listing while you were reviewing it.', code: 'LISTING_CHANGED' } });
    wrap(<Listings openId="l1" onOpen={() => {}} />);
    await screen.findByRole('button', { name: /approve as new product/i });
    fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), { target: { value: 'cat1' } });
    fireEvent.click(screen.getByRole('button', { name: /use suggested/i }));
    fireEvent.click(screen.getByRole('button', { name: /approve as new product/i }));
    expect(await screen.findByText(/supplier changed this listing/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /load their latest version/i })).toBeInTheDocument();
  });

  test('link to a likely duplicate without changing the price', async () => {
    const dup = { id: 'p9', name: 'Wiper 24 existing', slug: 'wiper-24', sku: 'AP24U', price: 3200, stock: 'in', isActive: true, productType: 'simple', image: '' };
    get.mockImplementation((url: string) => (url.includes('/margin-rules')
      ? Promise.resolve({ rules: RULES })
      : Promise.resolve({ listing: { ...LISTING, duplicates: [dup] } })));
    post.mockResolvedValue({ listing: LISTING, product: dup, created: false });
    wrap(<Listings openId="l1" onOpen={() => {}} />);
    const approve = await screen.findByRole('button', { name: /approve and link/i });
    expect(screen.getByRole('radio', { name: /wiper 24 existing/i })).toBeChecked();
    fireEvent.click(approve);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/procurement/partners/listings/l1/approve-link', { rev: 4, productId: 'p9', setPrice: false }));
  });
});

const ACCOUNT: AccountDetail = {
  id: 'a1', companyName: 'Acme Parts', contactName: 'Ravi', email: 'a@x.in', phone: '98', city: 'Kochi', status: 'in_review',
  submittedAt: null, reviewedAt: null, reviewedByName: '', supplierId: null, address: '', gstin: '32ABCDE1234F1Z5', pan: '', reviewNote: '', createdAt: null,
  documents: { gstCertificate: null, cancelledCheque: null },
  bank: { accountName: 'Acme', accountNumber: '123456789012', accountLast4: '9012', ifsc: 'HDFC0001234', upiId: '' },
  possibleSuppliers: [{ id: 's1', name: 'Acme Old', gstin: '32ABCDE1234F1Z5', phone: '', accountMasked: 'XXXX7777', ifsc: 'SBIN0000001', upiId: '' }],
};

describe('approve a supplier', () => {
  test('links the suggested supplier; different bank → copy only when ticked', async () => {
    post.mockResolvedValue({ account: { ...ACCOUNT, status: 'approved' }, bankChanged: true, created: false });
    const done = jest.fn();
    wrap(<ApproveBox account={ACCOUNT} onDone={done} />);
    expect(screen.getByText(/bank details in the app are different/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /use the app's bank details/i }));
    fireEvent.click(screen.getByRole('button', { name: /approve supplier/i }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/procurement/partners/accounts/a1/approve', { mode: 'link', supplierId: 's1', copyBank: true }));
    await waitFor(() => expect(done).toHaveBeenCalledWith(expect.stringMatching(/bank details changed/i)));
  });

  test('add as new', async () => {
    post.mockResolvedValue({ account: { ...ACCOUNT, status: 'approved' }, bankChanged: false, created: true });
    wrap(<ApproveBox account={ACCOUNT} onDone={() => {}} />);
    fireEvent.click(screen.getByRole('radio', { name: /add as a new supplier/i }));
    fireEvent.click(screen.getByRole('button', { name: /approve supplier/i }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/procurement/partners/accounts/a1/approve', { mode: 'new' }));
  });
});
