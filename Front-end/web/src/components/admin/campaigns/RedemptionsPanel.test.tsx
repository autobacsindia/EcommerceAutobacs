import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RedemptionsPanel from './RedemptionsPanel';
import apiClient from '@/lib/api';

/**
 * This panel exists because the member roster is structurally blind to a PUBLIC
 * campaign — no member rows are ever written for one, so its table stays empty while
 * money goes out the door. The cases below pin the two things that make this a
 * trustworthy replacement: a redemption is never silently read as a completed sale
 * (payment state is always shown), and paging cannot repeat or skip a row.
 */
jest.mock('@/lib/api', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

const get = apiClient.get as jest.Mock;

const redemption = (id: string, over = {}) => ({
  _id: id,
  code: 'FESTIVE2026',
  discountAmount: 150,
  createdAt: '2026-08-20T06:30:00.000Z',
  user: { _id: `u${id}`, name: 'Asha', email: `${id}@x.com` },
  order: {
    _id: `order${id}0000`, status: 'processing', paymentStatus: 'paid',
    totalAmount: 1500, createdAt: '2026-08-20T06:30:00.000Z',
  },
  ...over,
});

const renderPanel = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RedemptionsPanel slug="festive-2026" />
    </QueryClientProvider>,
  );
};

beforeEach(() => get.mockReset());

describe('RedemptionsPanel', () => {
  it('names the customer, the order and what the discount cost', async () => {
    get.mockResolvedValue({ redemptions: [redemption('a')], nextCursor: null });
    renderPanel();

    expect(await screen.findByText('a@x.com')).toBeInTheDocument();
    expect(screen.getByText('Asha')).toBeInTheDocument();
    expect(screen.getByText('₹1,500')).toBeInTheDocument();
    expect(screen.getByText('₹150')).toBeInTheDocument();
  });

  /*
    The whole reason this table is not just a list of buyers: a row exists from ORDER
    CREATION, before any money has moved. Rendering an unpaid redemption identically to
    a paid one would restate the exact overcount the panel was built to expose.
  */
  it('shows payment state, so an unpaid redemption is not read as a sale', async () => {
    get.mockResolvedValue({
      redemptions: [
        redemption('a'),
        redemption('b', { order: { ...redemption('b').order, paymentStatus: 'pending' } }),
      ],
      nextCursor: null,
    });
    renderPanel();

    expect(await screen.findByText('paid')).toBeInTheDocument();
    expect(screen.getByText('pending')).toBeInTheDocument();
  });

  it('still shows a redemption whose customer account was deleted — it still cost money', async () => {
    get.mockResolvedValue({ redemptions: [redemption('a', { user: null })], nextCursor: null });
    renderPanel();
    expect(await screen.findByText('account removed')).toBeInTheDocument();
  });

  it('still shows a redemption whose order was deleted', async () => {
    get.mockResolvedValue({ redemptions: [redemption('a', { order: null })], nextCursor: null });
    renderPanel();
    expect(await screen.findByText('order removed')).toBeInTheDocument();
    // Falls back to the neutral state rather than claiming the order was paid.
    expect(screen.getByText('pending')).toBeInTheDocument();
  });

  it('says plainly that nobody has redeemed, rather than rendering an empty table', async () => {
    get.mockResolvedValue({ redemptions: [], nextCursor: null });
    renderPanel();
    expect(await screen.findByText(/nobody has redeemed/i)).toBeInTheDocument();
  });

  it('carries the cursor forward so the next page starts where the last ended', async () => {
    get.mockResolvedValue({ redemptions: [redemption('a')], nextCursor: 'CURSOR1' });
    renderPanel();
    await screen.findByText('a@x.com');

    get.mockResolvedValue({ redemptions: [redemption('b')], nextCursor: null });
    fireEvent.click(screen.getByText('Next'));

    await waitFor(() => expect(get).toHaveBeenLastCalledWith(expect.stringContaining('cursor=CURSOR1')));
    expect(await screen.findByText('b@x.com')).toBeInTheDocument();
    // Replaced, not appended — this is a paged table, not an infinite list.
    expect(screen.queryByText('a@x.com')).not.toBeInTheDocument();
  });

  /*
    Keyset cursors are forward-only, so "Previous" cannot be derived — it has to walk
    back over remembered cursors. Getting this wrong silently strands an admin on page 2.
  */
  it('walks back to the previous page without a cursor', async () => {
    get.mockResolvedValue({ redemptions: [redemption('a')], nextCursor: 'CURSOR1' });
    renderPanel();
    await screen.findByText('a@x.com');
    expect(screen.getByText('Previous')).toBeDisabled();

    get.mockResolvedValue({ redemptions: [redemption('b')], nextCursor: null });
    fireEvent.click(screen.getByText('Next'));
    await screen.findByText('b@x.com');
    expect(screen.getByText('Page 2')).toBeInTheDocument();

    get.mockResolvedValue({ redemptions: [redemption('a')], nextCursor: 'CURSOR1' });
    fireEvent.click(screen.getByText('Previous'));
    await waitFor(() => expect(screen.getByText('Page 1')).toBeInTheDocument());
    expect(await screen.findByText('a@x.com')).toBeInTheDocument();
  });

  it('bounds the page size it asks for', async () => {
    get.mockResolvedValue({ redemptions: [], nextCursor: null });
    renderPanel();
    await waitFor(() => expect(get).toHaveBeenCalledWith(expect.stringContaining('limit=25')));
  });
});
