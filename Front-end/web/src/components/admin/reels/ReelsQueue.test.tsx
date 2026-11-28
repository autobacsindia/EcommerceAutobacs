/**
 * Staff Reels review queue. Fixtures follow the shared API contract in the
 * reels plan exactly (GET /admin/reels → { reels, nextCursor }).
 *
 * Invariants guarded here:
 *  - actions are server-confirmed: the card only leaves a tab after a refetch;
 *  - a reel cannot be rejected without a reason;
 *  - Reject/Remove ask for confirmation first;
 *  - "Load more" sends the server's cursor, never an offset.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ReelsQueue from './ReelsQueue';
import type { Reel } from './api';

const getMock = jest.fn();
const postMock = jest.fn();
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: {
    get: (...a: unknown[]) => getMock(...a),
    post: (...a: unknown[]) => postMock(...a),
  },
}));

function makeReel(over: Partial<Reel> = {}): Reel {
  return {
    id: 'r1',
    status: 'pending',
    hlsUrl: 'https://res.cloudinary.com/demo/video/upload/sp_auto/reels/r1.m3u8',
    mp4Url: 'https://res.cloudinary.com/demo/video/upload/reels/r1.mp4',
    posterUrl: 'https://res.cloudinary.com/demo/video/upload/reels/r1.jpg',
    durationSec: 24,
    caption: 'Night test of the dash cam',
    createdAt: '2026-11-18T09:30:00.000Z',
    creator: { id: 'u1', name: 'Asha Rao', avatarUrl: null },
    product: {
      id: 'p1', slug: 'dash-cam-a500', title: '70mai Dash Cam A500S', image: 'https://res.cloudinary.com/demo/image/upload/p1.jpg',
      price: 8999, mrp: 11999, discountPercent: 25, averageRating: 4.5, ratingCount: 780, availability: 'in',
    },
    likeCount: 0,
    viewerLiked: false,
    shareUrl: 'https://autobacsindia.com/reels/r1',
    ...over,
  };
}

function renderQueue() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><ReelsQueue /></QueryClientProvider>);
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
});

describe('list states', () => {
  it('shows a loading skeleton, then the reels', async () => {
    let resolve!: (v: unknown) => void;
    getMock.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderQueue();
    expect(screen.getByLabelText('Loading reels')).toBeInTheDocument();

    resolve({ reels: [makeReel()], nextCursor: null });
    expect(await screen.findByText('Night test of the dash cam')).toBeInTheDocument();
    expect(screen.queryByLabelText('Loading reels')).not.toBeInTheDocument();

    const card = screen.getByTestId('reel-card');
    expect(within(card).getByText('Asha Rao')).toBeInTheDocument();
    expect(within(card).getByText('70mai Dash Cam A500S')).toBeInTheDocument();
    expect(within(card).getByText('₹8,999.00')).toBeInTheDocument();
    expect(card.querySelector('video')).toHaveAttribute('poster', makeReel().posterUrl);
    expect(getMock).toHaveBeenCalledWith('/admin/reels?status=pending&limit=20');
  });

  it('shows the empty message for the tab', async () => {
    getMock.mockResolvedValue({ reels: [], nextCursor: null });
    renderQueue();
    expect(await screen.findByText('No reels are waiting for review.')).toBeInTheDocument();
  });

  it('shows an error with a retry', async () => {
    getMock.mockRejectedValueOnce(new Error('boom'));
    renderQueue();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load the reels.');

    getMock.mockResolvedValue({ reels: [makeReel()], nextCursor: null });
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Night test of the dash cam')).toBeInTheDocument();
  });

  it('switches tab by status and loads more with the server cursor', async () => {
    getMock.mockImplementation((url: string) => {
      if (url.includes('cursor=c2')) return Promise.resolve({ reels: [makeReel({ id: 'r3', status: 'approved', caption: 'Second page' })], nextCursor: null });
      if (url.includes('status=approved')) return Promise.resolve({ reels: [makeReel({ id: 'r2', status: 'approved', caption: 'First page' })], nextCursor: 'c2' });
      return Promise.resolve({ reels: [], nextCursor: null });
    });
    renderQueue();
    fireEvent.click(await screen.findByRole('tab', { name: 'Live' }));
    expect(await screen.findByText('First page')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Second page')).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith('/admin/reels?status=approved&limit=20&cursor=c2');
    expect(screen.getByText('First page')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('flags a reel whose product is no longer on sale', async () => {
    getMock.mockResolvedValue({ reels: [makeReel({ product: null })], nextCursor: null });
    renderQueue();
    expect(await screen.findByText(/no longer on sale/)).toBeInTheDocument();
  });
});

describe('approve', () => {
  it('approves on the server, then refetches (not optimistic)', async () => {
    getMock.mockResolvedValueOnce({ reels: [makeReel()], nextCursor: null });
    let finish!: (v: unknown) => void;
    postMock.mockReturnValue(new Promise((r) => { finish = r; }));
    renderQueue();

    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/admin/reels/r1/approve', {}));
    // Still on screen while the server decides.
    expect(await screen.findByRole('button', { name: 'Approving…' })).toBeDisabled();
    expect(screen.getByText('Night test of the dash cam')).toBeInTheDocument();

    getMock.mockResolvedValue({ reels: [], nextCursor: null });
    finish({ success: true });
    expect(await screen.findByText('No reels are waiting for review.')).toBeInTheDocument();
  });

  it('keeps the reel and shows the server error when approve fails', async () => {
    getMock.mockResolvedValue({ reels: [makeReel()], nextCursor: null });
    postMock.mockRejectedValue(new Error('Product is inactive'));
    renderQueue();
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Product is inactive');
    expect(screen.getByText('Night test of the dash cam')).toBeInTheDocument();
  });
});

describe('reject', () => {
  it('cannot reject without a reason', async () => {
    getMock.mockResolvedValue({ reels: [makeReel()], nextCursor: null });
    renderQueue();
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));

    const dialog = screen.getByRole('dialog', { name: 'Reject this reel?' });
    const confirm = within(dialog).getByRole('button', { name: 'Reject reel' });
    expect(confirm).toBeDisabled();
    expect(within(dialog).getByText('A reason is needed to reject.')).toBeInTheDocument();

    // Whitespace is not a reason.
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '   ' } });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    fireEvent.submit(within(dialog).getByRole('textbox').closest('form')!);
    expect(postMock).not.toHaveBeenCalled();
  });

  it('sends the preset plus the typed note, then closes and refetches', async () => {
    getMock.mockResolvedValueOnce({ reels: [makeReel()], nextCursor: null });
    postMock.mockResolvedValue({ success: true });
    renderQueue();
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Wrong product tagged' }));
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'This is the A800, not the A500S' } });

    getMock.mockResolvedValue({ reels: [], nextCursor: null });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject reel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(postMock).toHaveBeenCalledWith('/admin/reels/r1/reject', { reason: 'Wrong product tagged. This is the A800, not the A500S' });
    expect(await screen.findByText('No reels are waiting for review.')).toBeInTheDocument();
  });

  it('cancel closes without calling the server', async () => {
    getMock.mockResolvedValue({ reels: [makeReel()], nextCursor: null });
    renderQueue();
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });

  it('keeps the dialog open with the error if the server refuses', async () => {
    getMock.mockResolvedValue({ reels: [makeReel()], nextCursor: null });
    postMock.mockRejectedValue(new Error('Reel was already approved'));
    renderQueue();
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Inappropriate content' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject reel' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Reel was already approved');
  });

  it('shows the reject reason on the Rejected tab', async () => {
    getMock.mockImplementation((url: string) => Promise.resolve(url.includes('status=rejected')
      ? { reels: [makeReel({ status: 'rejected', rejectReason: 'Video is blurry or too dark' })], nextCursor: null }
      : { reels: [], nextCursor: null }));
    renderQueue();
    fireEvent.click(await screen.findByRole('tab', { name: 'Rejected' }));
    expect(await screen.findByText('Video is blurry or too dark')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });
});

describe('remove', () => {
  it('asks for confirmation, then removes a live reel', async () => {
    getMock.mockImplementation((url: string) => Promise.resolve(url.includes('status=approved')
      ? { reels: [makeReel({ status: 'approved', likeCount: 12 })], nextCursor: null }
      : { reels: [], nextCursor: null }));
    postMock.mockResolvedValue({ success: true });
    renderQueue();
    fireEvent.click(await screen.findByRole('tab', { name: 'Live' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(postMock).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog', { name: 'Remove this live reel?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove reel' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/admin/reels/r1/remove', {}));
  });
});

describe('contract change 2026-11-18 fields', () => {
  it('reads the wrapped { success, reels } response and shows team badge, reports, backorder, festival price', async () => {
    getMock.mockResolvedValue({
      success: true,
      reels: [makeReel({
        source: 'team', reportCount: 2, creator: { id: null, name: 'Autobacs India', avatarUrl: null },
        product: { ...makeReel().product!, availability: 'backorder', festivalPrice: 7999, hasVariants: true },
      })],
      nextCursor: null,
    });
    renderQueue();
    const card = await screen.findByTestId('reel-card');
    expect(within(card).getByText('Team')).toBeInTheDocument();
    expect(within(card).getByText('2 reports')).toBeInTheDocument();
    expect(within(card).getByText('On backorder')).toBeInTheDocument();
    expect(within(card).getByText('Festival offer ₹7,999.00')).toBeInTheDocument();
    expect(within(card).getByText('onwards')).toBeInTheDocument();
  });

  it('treats productLive:false as hidden from shoppers even if a product block is present', async () => {
    getMock.mockResolvedValue({ success: true, reels: [makeReel({ productLive: false })], nextCursor: null });
    renderQueue();
    expect(await screen.findByText(/no longer on sale/)).toBeInTheDocument();
  });

  it('a rejected reel can be approved after all (server-confirmed)', async () => {
    getMock.mockImplementation((url: string) => Promise.resolve(url.includes('status=rejected')
      ? { success: true, reels: [makeReel({ status: 'rejected', rejectReason: 'Wrong product tagged' })], nextCursor: null }
      : { success: true, reels: [], nextCursor: null }));
    postMock.mockResolvedValue({ success: true });
    renderQueue();
    fireEvent.click(await screen.findByRole('tab', { name: 'Rejected' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Approve after all' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/admin/reels/r1/approve', {}));
    // Reject is never offered on a non-pending reel (backend: reject from pending only).
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
  });

  it('a reel being converted has its own tab, a plain note, and no approve/reject buttons', async () => {
    getMock.mockImplementation((url: string) => Promise.resolve(url.includes('status=processing')
      ? { success: true, reels: [makeReel({ status: 'processing', mp4Url: null })], nextCursor: null }
      : { success: true, reels: [], nextCursor: null }));
    renderQueue();
    fireEvent.click(await screen.findByRole('tab', { name: 'Converting' }));
    expect(await screen.findByText(/Converting this video so it plays on every phone/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
  });

  it('a reel whose conversion failed cannot be approved after all', async () => {
    getMock.mockImplementation((url: string) => Promise.resolve(url.includes('status=rejected')
      ? { success: true, reels: [makeReel({ status: 'rejected', mp4Url: null, rejectReason: "We couldn't prepare this video for all phones." })], nextCursor: null }
      : { success: true, reels: [], nextCursor: null }));
    renderQueue();
    fireEvent.click(await screen.findByRole('tab', { name: 'Rejected' }));
    expect(await screen.findByText(/could not be converted/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve after all' })).not.toBeInTheDocument();
  });

  it('shows the server 409 message when a reel changed state underneath us', async () => {
    getMock.mockResolvedValue({ success: true, reels: [makeReel({ status: 'approved' })], nextCursor: null });
    postMock.mockRejectedValue(new Error('This reel is already removed. Refresh to see its latest state.'));
    renderQueue();
    fireEvent.click(await screen.findByRole('tab', { name: 'Live' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove reel' }));
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('already removed');
  });
});
