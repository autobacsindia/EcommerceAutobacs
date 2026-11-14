/**
 * Procurement screens: an enquiry is sent with a one-time form key and supplier
 * ids; each supplier gets their own wa.me link with their name in the message;
 * opening WhatsApp marks them sent; replies are recorded per item; the cheapest
 * is marked; a supplier can be added with just a name and WhatsApp number; the
 * calculator shows the numbers as you type.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import EnquiryForm from './EnquiryForm';
import EnquiryDetail from './EnquiryDetail';
import PriceCalculator from './PriceCalculator';
import ShippingCalculator from './ShippingCalculator';
import type { Enquiry } from './enquiry';
import { addressBar } from '@/test-utils/addressBarMock';

const get = jest.fn();
const post = jest.fn();
const put = jest.fn();
const del = jest.fn();
const postForm = jest.fn();
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), put: (...a: unknown[]) => put(...a), delete: (...a: unknown[]) => del(...a) },
}));
jest.mock('@/lib/postForm', () => ({ postForm: (...a: unknown[]) => postForm(...a) }));
// jsdom has no object URLs.
Object.assign(URL, { createObjectURL: jest.fn(() => 'blob:preview'), revokeObjectURL: jest.fn() });
jest.mock('next/navigation', () => jest.requireActual('@/test-utils/addressBarMock').nextNavigation);
jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { name: 'Priya', role: 'staff', staff: { team: 'procurement' } } }) }));

const wrap = (ui: React.ReactElement) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);

const SUPPLIERS = [
  { id: 's1', name: 'Ravi Motors', phone: '98000 00001', contactPerson: '', payment: { method: 'none' } },
  { id: 's2', name: 'Tyre World', phone: '9800000002', contactPerson: 'Joe', payment: { method: 'upi' } },
];

const ENQ: Enquiry = {
  id: 'e1', ref: 'ENQ-2611-0007', status: 'replied', neededBy: null, deliverTo: 'Kochi', notes: '', showTargetPrice: false,
  contactName: 'Priya', createdByName: 'Priya', createdAt: '2026-11-13T06:00:00.000Z', updatedAt: '2026-11-13T06:00:00.000Z',
  closedAt: null, closedByName: '', closeNote: '', chosenSupplierRow: null,
  items: [{ id: 'i1', productId: null, name: 'Car wax', brand: '3M', partNo: '39030', fitment: '', qty: 10, unit: 'pcs', targetPaise: 45000, note: '' }],
  suppliers: [
    { id: 'r1', supplierId: 's1', name: 'Ravi Motors', phone: '98000 00001', sentAt: null, repliedAt: '2026-11-13T07:00:00.000Z', note: '',
      quotes: [{ itemId: 'i1', unitPaise: 40000, gstRate: 18, gstIncluded: false, available: 'yes', dispatchDays: 2, note: '' }] },
    { id: 'r2', supplierId: 's2', name: 'Tyre World', phone: '9800000002', sentAt: null, repliedAt: '2026-11-13T07:00:00.000Z', note: '',
      quotes: [{ itemId: 'i1', unitPaise: 47000, gstRate: 18, gstIncluded: true, available: 'yes', dispatchDays: null, note: '' }] },
  ],
  best: { i1: 'r2' },
};

beforeEach(() => {
  addressBar.reset('/team/supplier-enquiries/new');
  get.mockReset(); post.mockReset(); put.mockReset(); del.mockReset(); postForm.mockReset();
  get.mockImplementation(async (url: string) => {
    if (url.startsWith('/suppliers')) return { suppliers: SUPPLIERS, nextAfter: null, sort: 'name' };
    if (url.startsWith('/supplier-enquiries/products')) return { products: [] };
    if (url === '/supplier-enquiries/e1') return { enquiry: ENQ };
    throw new Error(`unexpected GET ${url}`);
  });
});

describe('writing an enquiry', () => {
  it('sends items, supplier ids and a one-time form key; the preview is the WhatsApp text', async () => {
    post.mockResolvedValue({ enquiry: { ...ENQ, id: 'new1' } });
    wrap(<EnquiryForm base="/team/supplier-enquiries" />);
    fireEvent.change(screen.getByLabelText('Product'), { target: { value: 'Car wax 500 ml' } });
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(/Target \/ last price/), { target: { value: '450' } });
    fireEvent.click(await screen.findByRole('checkbox', { name: /Ravi Motors/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Tyre World/ }));

    const preview = screen.getByTestId('wa-preview');
    expect(preview).toHaveTextContent('Dear Ravi Motors,');
    expect(preview).toHaveTextContent('1. Car wax 500 ml');
    expect(preview).not.toHaveTextContent('Target'); // private by default

    fireEvent.click(screen.getByRole('button', { name: 'Save and send' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [url, body] = post.mock.calls[0];
    expect(url).toBe('/supplier-enquiries');
    expect(body).toMatchObject({ supplierIds: ['s1', 's2'], showTargetPrice: false, items: [{ name: 'Car wax 500 ml', qty: 10, target: '450', unit: 'pcs' }] });
    expect(body.formKey).toMatch(/^[A-Za-z0-9]{16,}$/);
    expect(body.items[0]).not.toHaveProperty('key');
    await waitFor(() => expect(addressBar.push).toHaveBeenCalledWith('/team/supplier-enquiries/new1'));
  });

  it('says what is missing instead of sending', async () => {
    wrap(<EnquiryForm base="/team/supplier-enquiries" />);
    fireEvent.click(screen.getByRole('button', { name: 'Save and send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Add at least one item.');
    fireEvent.change(screen.getByLabelText('Product'), { target: { value: 'Car wax' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Pick at least one supplier.');
    expect(post).not.toHaveBeenCalled();
  });

  it('a new supplier needs only a name and WhatsApp number, and is picked straight away', async () => {
    post.mockResolvedValueOnce({ supplier: { id: 's9', name: 'New Parts Co', phone: '9811111111', payment: { method: 'none' } } });
    wrap(<EnquiryForm base="/team/supplier-enquiries" />);
    fireEvent.click(screen.getByRole('button', { name: /New supplier/ }));
    fireEvent.change(screen.getByLabelText('New supplier name'), { target: { value: 'New Parts Co' } });
    fireEvent.change(screen.getByLabelText('New supplier WhatsApp number'), { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save supplier' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/WhatsApp number/);
    fireEvent.change(screen.getByLabelText('New supplier WhatsApp number'), { target: { value: '98111 11111' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save supplier' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/suppliers', expect.objectContaining({ name: 'New Parts Co', payment: expect.objectContaining({ method: 'none' }) })));
    expect(await screen.findByRole('list', { name: 'Picked suppliers' })).toHaveTextContent('New Parts Co');
  });

  it('the calculator fills the target price', async () => {
    wrap(<EnquiryForm base="/team/supplier-enquiries" />);
    fireEvent.click(screen.getByRole('button', { name: /Calculator/ }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Most we can pay' })); // loads on demand
    fireEvent.change(screen.getByLabelText('Customer pays (incl. GST)'), { target: { value: '1180' } });
    fireEvent.change(screen.getByLabelText('Margin we want'), { target: { value: '20' } });
    fireEvent.click(await screen.findByRole('button', { name: /Use as target price: ₹800 \+ GST/ }));
    expect(screen.getByLabelText(/Target \/ last price/)).toHaveValue('800');
  });
});

describe('photos', () => {
  const jpeg = (name: string) => new File([new Uint8Array([0xff, 0xd8, 0xff, 1])], name, { type: 'image/jpeg' });
  const PHOTO_ENQ: Enquiry = {
    ...ENQ, status: 'sent',
    items: [{ ...ENQ.items[0], image: 'https://res.cloudinary.com/x/wax.jpg', photos: [{ id: 'p1', name: 'side.jpg', contentType: 'image/jpeg' }] }],
  };

  it('chosen photos upload to the saved item after the enquiry saves', async () => {
    post.mockResolvedValue({ enquiry: { ...ENQ, id: 'new1', items: [{ ...ENQ.items[0], id: 'srv1' }] } });
    postForm.mockResolvedValue({ enquiry: { ...ENQ, id: 'new1' } });
    wrap(<EnquiryForm base="/team/supplier-enquiries" />);
    fireEvent.change(screen.getByLabelText('Product'), { target: { value: 'Car wax' } });
    fireEvent.change(screen.getByLabelText('Add photos to item 1'), { target: { files: [jpeg('a.jpg'), jpeg('b.jpg')] } });
    expect(screen.getByRole('button', { name: 'Remove photo 2 of item 1' })).toBeInTheDocument();
    expect(screen.getByTestId('wa-preview')).toHaveTextContent('📷 2 photos sent with this message');
    fireEvent.click(await screen.findByRole('checkbox', { name: /Ravi Motors/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save and send' }));
    await waitFor(() => expect(postForm).toHaveBeenCalledTimes(1));
    const [url, form] = postForm.mock.calls[0];
    expect(url).toBe('/supplier-enquiries/new1/items/srv1/photos');
    expect((form as FormData).getAll('photo').map((f) => (f as File).name)).toEqual(['a.jpg', 'b.jpg']);
    expect(post.mock.calls[0][1].items[0]).not.toHaveProperty('files');
    await waitFor(() => expect(addressBar.push).toHaveBeenCalledWith('/team/supplier-enquiries/new1'));
  });

  it('a failed photo upload still opens the saved enquiry, flagged', async () => {
    post.mockResolvedValue({ enquiry: { ...ENQ, id: 'new1', items: [{ ...ENQ.items[0], id: 'srv1' }] } });
    postForm.mockRejectedValue(new Error('network'));
    wrap(<EnquiryForm base="/team/supplier-enquiries" />);
    fireEvent.change(screen.getByLabelText('Product'), { target: { value: 'Car wax' } });
    fireEvent.change(screen.getByLabelText('Add photos to item 1'), { target: { files: [jpeg('a.jpg')] } });
    fireEvent.click(await screen.findByRole('checkbox', { name: /Ravi Motors/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save and send' }));
    await waitFor(() => expect(addressBar.push).toHaveBeenCalledWith('/team/supplier-enquiries/new1?photos=failed'));
  });

  it('only 3 per item, and only images', async () => {
    wrap(<EnquiryForm base="/team/supplier-enquiries" />);
    const pick = screen.getByLabelText('Add photos to item 1');
    fireEvent.change(pick, { target: { files: [new File(['x'], 'bill.pdf', { type: 'application/pdf' })] } });
    expect(screen.getByText('Only photos up to 10 MB can be added.')).toBeInTheDocument();
    fireEvent.change(pick, { target: { files: [jpeg('1.jpg'), jpeg('2.jpg'), jpeg('3.jpg'), jpeg('4.jpg')] } });
    expect(screen.getByText(/An item can have 3 photos/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Remove photo \d of item 1/ })).toHaveLength(3);
    expect(screen.queryByLabelText('Add photos to item 1')).not.toBeInTheDocument();
  });

  it('the enquiry shows its photos, links the catalogue one in the message, and removes one', async () => {
    get.mockImplementation(async () => ({ enquiry: PHOTO_ENQ }));
    del.mockResolvedValue({ enquiry: { ...PHOTO_ENQ, items: [{ ...PHOTO_ENQ.items[0], photos: [] }] } });
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    wrap(<EnquiryDetail id="e1" base="/team/supplier-enquiries" />);
    const section = (await screen.findByRole('heading', { name: 'Photos' })).closest('section')!;
    expect(within(section).getByRole('img', { name: 'side.jpg' })).toHaveAttribute('src', '/api/v1/supplier-enquiries/e1/photos/p1');
    expect(within(section).getByRole('button', { name: /Download photos \(1\)/ })).toBeInTheDocument();
    expect(screen.getByTestId('wa-preview')).toHaveTextContent('Photo: https://res.cloudinary.com/x/wax.jpg');
    expect(screen.getByText(/WhatsApp links carry text only/)).toBeInTheDocument();
    fireEvent.click(within(section).getByRole('button', { name: 'Remove photo side.jpg' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/supplier-enquiries/e1/photos/p1'));
    await waitFor(() => expect(within(section).queryByRole('img', { name: 'side.jpg' })).not.toBeInTheDocument());
  });

  it('Share sends the text and the photos together where the phone can', async () => {
    get.mockImplementation(async () => ({ enquiry: PHOTO_ENQ }));
    post.mockResolvedValue({ enquiry: PHOTO_ENQ });
    const share = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { share, canShare: () => true });
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, blob: async () => new Blob([new Uint8Array([1])], { type: 'image/jpeg' }) });
    const realFetch = global.fetch;
    global.fetch = fetchMock as unknown as typeof fetch;
    try {
      wrap(<EnquiryDetail id="e1" base="/team/supplier-enquiries" />);
      const buttons = await screen.findAllByRole('button', { name: 'Share' });
      fireEvent.click(buttons[0]);
      await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
      const data = share.mock.calls[0][0];
      expect(data.text).toContain('Dear Ravi Motors,');
      expect(data.files.map((f: File) => f.name)).toEqual(['ENQ-2611-0007-item1-1.jpg']);
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/supplier-enquiries/e1/photos/p1', { credentials: 'include' });
    } finally {
      global.fetch = realFetch;
      delete (navigator as unknown as Record<string, unknown>).share;
      delete (navigator as unknown as Record<string, unknown>).canShare;
    }
  });
});

describe('an enquiry', () => {
  it('each supplier gets their own WhatsApp link; opening it marks them sent', async () => {
    post.mockResolvedValue({ enquiry: ENQ });
    wrap(<EnquiryDetail id="e1" base="/team/supplier-enquiries" />);
    const links = await screen.findAllByRole('link', { name: /Open WhatsApp/ });
    expect(links).toHaveLength(2);
    const href = links[0].getAttribute('href')!;
    expect(href.startsWith('https://wa.me/919800000001?text=')).toBe(true);
    expect(decodeURIComponent(href.split('text=')[1])).toContain('Dear Ravi Motors,');
    expect(decodeURIComponent(links[1].getAttribute('href')!.split('text=')[1])).toContain('Dear Tyre World,');
    expect(links[0]).toHaveAttribute('target', '_blank');
    fireEvent.click(links[0]);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/supplier-enquiries/e1/suppliers/r1/sent', {}));
  });

  it('marks the cheapest incl. GST, and records a reply per item', async () => {
    put.mockResolvedValue({ enquiry: ENQ });
    wrap(<EnquiryDetail id="e1" base="/team/supplier-enquiries" />);
    const best = await screen.findByText('Best price');
    expect(best.closest('li')).toHaveTextContent('Tyre World');
    expect(best.closest('li')).toHaveTextContent('₹470');
    // Ravi: ₹400 + 18% = ₹472
    expect(screen.getAllByText('₹472').length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit reply' })[0]);
    const form = screen.getByRole('group', { name: 'Reply from Ravi Motors' });
    fireEvent.change(within(form).getByLabelText('Price / unit (₹)'), { target: { value: '390' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save reply' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/supplier-enquiries/e1/suppliers/r1/quote', {
      quotes: [{ itemId: 'i1', unitPrice: '390', gstRate: 18, gstIncluded: false, available: 'yes', dispatchDays: '2', note: '' }], note: '',
    }));
  });

  it('a load failure says so and offers a retry', async () => {
    get.mockRejectedValue({ rawData: { message: 'Enquiry not found.' } });
    wrap(<EnquiryDetail id="e1" base="/team/supplier-enquiries" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Enquiry not found.');
  });
});

describe('the price calculator', () => {
  it('works out the numbers as you type, and shows the working', async () => {
    render(<PriceCalculator />);
    expect(screen.getByText('Enter the supplier price to see the numbers.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Supplier price (per unit)'), { target: { value: '1000' } });
    fireEvent.change(screen.getByLabelText('Freight'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('Target margin'), { target: { value: '20' } });
    expect(screen.getAllByText('₹1,548.75')).toHaveLength(2); // customer pays = selling price (no discount)
    expect(screen.getByText('₹262.50')).toBeInTheDocument();   // profit
    fireEvent.click(screen.getByRole('button', { name: 'Show the working' }));
    expect(screen.getByText(/Landed cost \(per unit\)/)).toBeInTheDocument();
  });

  it('flags a typo in the field', () => {
    render(<PriceCalculator />);
    fireEvent.change(screen.getByLabelText('Supplier price (per unit)'), { target: { value: '12.345' } });
    expect(screen.getByLabelText('Supplier price (per unit)')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('the shipping fee calculator', () => {
  const FOUND = {
    found: true, pin: '682001', weightKg: 2.5, items: [], missingWeight: [],
    zone: { name: 'Kerala metro', type: 'metro' }, deliveryDays: { min: 2, max: 4 },
    basePaise: 5000, perKgPaise: 2050, weightPaise: 5125, totalPaise: 10125,
  };

  it('pincode + weight → the charge with its breakdown, and a link to use it as freight', async () => {
    post.mockResolvedValue({ estimate: FOUND });
    wrap(<ShippingCalculator freightHref="/team/price-calculator" />);
    fireEvent.change(screen.getByLabelText('Delivery pincode'), { target: { value: '682 001' } });
    fireEvent.change(screen.getByLabelText('Weight (kg)'), { target: { value: '2.5' } });
    fireEvent.click(screen.getByRole('button', { name: /Work out delivery charge/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/supplier-enquiries/shipping-estimate', { pin: '682001', weightKg: '2.5', items: [] }));
    expect(await screen.findByTestId('shipping-total')).toHaveTextContent('₹101.25');
    expect(screen.getByText(/Kerala metro · 2–4 days/)).toBeInTheDocument();
    expect(screen.getByText('Weight 2.5 kg × ₹20.50/kg')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Use as freight/ })).toHaveAttribute('href', '/team/price-calculator?freight=101.25');
  });

  it('checks the pincode and weight before asking the server', async () => {
    wrap(<ShippingCalculator />);
    fireEvent.change(screen.getByLabelText('Delivery pincode'), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: /Work out delivery charge/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('6-digit pincode');
    fireEvent.change(screen.getByLabelText('Delivery pincode'), { target: { value: '682001' } });
    fireEvent.change(screen.getByLabelText('Weight (kg)'), { target: { value: 'two' } });
    fireEvent.click(screen.getByRole('button', { name: /Work out delivery charge/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Weight should be in kg');
    expect(post).not.toHaveBeenCalled();
  });

  it('an unknown pincode, or no zones at all, says so plainly', async () => {
    post.mockResolvedValueOnce({ estimate: { found: false, pin: '110001', weightKg: 0, items: [], missingWeight: [], zonesConfigured: 3 } });
    wrap(<ShippingCalculator />);
    fireEvent.change(screen.getByLabelText('Delivery pincode'), { target: { value: '110001' } });
    fireEvent.click(screen.getByRole('button', { name: /Work out delivery charge/ }));
    expect(await screen.findByText('No delivery rate for 110001')).toBeInTheDocument();
    expect(screen.getByText(/not in any of our delivery zones/)).toBeInTheDocument();
    post.mockResolvedValueOnce({ estimate: { found: false, pin: '110001', weightKg: 0, items: [], missingWeight: [], zonesConfigured: 0 } });
    fireEvent.click(screen.getByRole('button', { name: /Work out delivery charge/ }));
    expect(await screen.findByText(/No delivery zones are set up yet/)).toBeInTheDocument();
  });

  it('picked products go with their quantities; ones without a weight are flagged', async () => {
    get.mockImplementation(async (url: string) => {
      if (url.startsWith('/supplier-enquiries/products')) return { products: [{ id: 'p1', name: 'Floor mat set', sku: 'FM1', image: '', price: 999 }] };
      throw new Error(`unexpected GET ${url}`);
    });
    post.mockResolvedValue({ estimate: { ...FOUND, items: [{ productId: 'p1', name: 'Floor mat set', qty: 2, weightKg: null }], missingWeight: ['Floor mat set'] } });
    wrap(<ShippingCalculator />);
    fireEvent.change(screen.getByLabelText(/Add products/), { target: { value: 'mat' } });
    fireEvent.click(await screen.findByRole('option', { name: /Floor mat set/ }));
    fireEvent.change(screen.getByLabelText('Quantity of Floor mat set'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Delivery pincode'), { target: { value: '682001' } });
    fireEvent.click(screen.getByRole('button', { name: /Work out delivery charge/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/supplier-enquiries/shipping-estimate', { pin: '682001', weightKg: '', items: [{ productId: 'p1', qty: 2 }] }));
    expect(await screen.findByRole('note')).toHaveTextContent('No packed weight saved for: Floor mat set');
  });

  it('a server refusal shows its message', async () => {
    post.mockRejectedValue({ rawData: { message: 'Only the procurement team can use this.' } });
    wrap(<ShippingCalculator />);
    fireEvent.change(screen.getByLabelText('Delivery pincode'), { target: { value: '682001' } });
    fireEvent.click(screen.getByRole('button', { name: /Work out delivery charge/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only the procurement team can use this.');
  });
});

describe('the price calculator takes freight from the shipping calculator', () => {
  it('pre-fills freight in both modes', () => {
    wrap(<PriceCalculator initialFreight="101.25" />);
    expect(screen.getByLabelText('Freight')).toHaveValue('101.25');
    fireEvent.click(screen.getByRole('tab', { name: 'Most we can pay' }));
    expect(screen.getByLabelText('Freight')).toHaveValue('101.25');
  });
});
