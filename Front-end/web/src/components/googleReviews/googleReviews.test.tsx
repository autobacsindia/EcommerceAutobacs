import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import SubmitReviewForm from './SubmitReviewForm';
import ReviewDecision from './ReviewDecision';
import ReviewList from './ReviewList';
import { describeHistory, screenshotProblem, suggestedPoints, type GoogleReview, type ReviewPolicy } from '@/lib/googleReviews';

const submitMutate = jest.fn();
const verifyMutate = jest.fn();
const rejectMutate = jest.fn();
const pending = { submit: false, verify: false, reject: false };
type Q = { data?: unknown; isLoading?: boolean; error?: unknown; isFetching?: boolean; hasNextPage?: boolean; fetchNextPage?: () => void; isFetchingNextPage?: boolean };
let listQ: Q = {};
let detail: GoogleReview | undefined;

jest.mock('@/hooks/queries/useGoogleReviews', () => ({
  useSubmitGoogleReview: () => ({ mutateAsync: submitMutate, isPending: pending.submit }),
  useVerifyGoogleReview: () => ({ mutateAsync: verifyMutate, isPending: pending.verify }),
  useRejectGoogleReview: () => ({ mutateAsync: rejectMutate, isPending: pending.reject }),
  useGoogleReview: (_id: string, initial: GoogleReview) => ({ data: detail || initial, isFetching: false }),
  useMyGoogleReviews: () => listQ,
  useGoogleReviewQueue: () => listQ,
}));

const policy: ReviewPolicy = { canSubmit: true, canReview: true, maxPoints: 100, suggestedByStars: [0, 0, 0, 30, 50], maxScreenshotBytes: 5 * 1024 * 1024 };

const review = (over: Partial<GoogleReview> = {}): GoogleReview => ({
  id: 'g1', status: 'pending', submittedBy: { id: 'u-nevin', name: 'Nevin P Vinu' }, customerName: 'Rahul Menon',
  customerPhone: '9847012345', orderId: null, orderNumber: '#5001', claimedStars: 5, notes: 'Shared link', stars: null,
  points: 0, creditMonth: null, reason: '', reviewedByName: '', reviewedAt: null, createdAt: '2026-11-12T06:00:00Z',
  version: 0, screenshotUrl: '/api/v1/google-reviews/g1/screenshot',
  history: [{ action: 'submitted', at: '2026-11-12T06:00:00Z', byName: 'Nevin P Vinu', stars: 5, points: null, deltaPoints: null, month: null, reason: '' }],
  ...over,
});

const png = (name = 'r.png', type = 'image/png', size = 1000) => {
  const f = new File([new Uint8Array(size)], name, { type });
  return f;
};

beforeAll(() => {
  // jsdom has no object URLs.
  Object.assign(URL, { createObjectURL: jest.fn(() => 'blob:preview'), revokeObjectURL: jest.fn() });
});
beforeEach(() => {
  submitMutate.mockReset(); verifyMutate.mockReset(); rejectMutate.mockReset();
  pending.submit = false; pending.verify = false; pending.reject = false;
  detail = undefined;
});

describe('SubmitReviewForm', () => {
  const fileInput = () => screen.getByLabelText('Screenshot file') as HTMLInputElement;

  test('needs a screenshot and a customer before sending', async () => {
    render(<SubmitReviewForm policy={policy} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send for checking' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Attach a screenshot');
    fireEvent.change(fileInput(), { target: { files: [png()] } });
    fireEvent.click(screen.getByRole('button', { name: 'Send for checking' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('name or phone');
    expect(submitMutate).not.toHaveBeenCalled();
  });

  test('refuses a PDF or a too-large image before uploading', () => {
    render(<SubmitReviewForm policy={policy} />);
    fireEvent.change(fileInput(), { target: { files: [png('r.pdf', 'application/pdf')] } });
    expect(screen.getByRole('alert')).toHaveTextContent('JPG, PNG or WebP');
    fireEvent.change(fileInput(), { target: { files: [png('big.png', 'image/png', 6 * 1024 * 1024)] } });
    expect(screen.getByRole('alert')).toHaveTextContent('5 MB');
  });

  test('sends the form with a submitId, then clears it for the next review', async () => {
    submitMutate.mockResolvedValue(review());
    render(<SubmitReviewForm policy={policy} />);
    fireEvent.change(fileInput(), { target: { files: [png()] } });
    fireEvent.change(screen.getByLabelText('Customer name'), { target: { value: 'Rahul Menon' } });
    fireEvent.change(screen.getByLabelText(/Customer phone/), { target: { value: '98470 12345' } });
    fireEvent.change(screen.getByLabelText(/Order number/), { target: { value: '#5001' } });
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Stars you saw' })).getByRole('radio', { name: '5 stars' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send for checking' }));
    await waitFor(() => expect(submitMutate).toHaveBeenCalledTimes(1));
    const form = submitMutate.mock.calls[0][0] as FormData;
    expect(form.get('customerName')).toBe('Rahul Menon');
    expect(form.get('customerPhone')).toBe('98470 12345');
    expect(form.get('orderRef')).toBe('#5001');
    expect(form.get('claimedStars')).toBe('5');
    expect(String(form.get('submitId'))).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(form.get('screenshot')).toBeInstanceOf(File);
    expect(await screen.findByRole('status')).toHaveTextContent('Sent');
    expect(screen.getByLabelText('Customer name')).toHaveValue('');

    // The next review gets a fresh submitId (so it is not mistaken for a retry).
    submitMutate.mockResolvedValue(review({ id: 'g2' }));
    fireEvent.change(fileInput(), { target: { files: [png('two.png')] } });
    fireEvent.change(screen.getByLabelText('Customer name'), { target: { value: 'Priya' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send for checking' }));
    await waitFor(() => expect(submitMutate).toHaveBeenCalledTimes(2));
    expect((submitMutate.mock.calls[1][0] as FormData).get('submitId')).not.toBe(form.get('submitId'));
  });

  test('shows the server\'s duplicate message and keeps what was typed', async () => {
    submitMutate.mockRejectedValue(Object.assign(new Error('x'), { rawData: { message: 'This screenshot was already sent. (sent by Asha)' } }));
    render(<SubmitReviewForm policy={policy} />);
    fireEvent.change(fileInput(), { target: { files: [png()] } });
    fireEvent.change(screen.getByLabelText('Customer name'), { target: { value: 'Rahul' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send for checking' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already sent. (sent by Asha)');
    expect(screen.getByLabelText('Customer name')).toHaveValue('Rahul');
  });

  test('the button is disabled while sending', () => {
    pending.submit = true;
    render(<SubmitReviewForm policy={policy} />);
    expect(screen.getByRole('button', { name: /Sending/ })).toBeDisabled();
  });
});

describe('ReviewDecision', () => {
  const open = (r: GoogleReview, meId = 'u-mkt') => {
    const onDone = jest.fn();
    const onClose = jest.fn();
    render(<ReviewDecision initial={r} policy={policy} meId={meId} onClose={onClose} onDone={onDone} />);
    return { onDone, onClose };
  };

  test('starts from the stars the salesperson saw and the suggested points; changing stars updates the suggestion', () => {
    open(review());
    expect(screen.getByRole('spinbutton')).toHaveValue(50);
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Stars on the screenshot' })).getByRole('radio', { name: '4 stars' }));
    expect(screen.getByRole('spinbutton')).toHaveValue(30);
    // Once the reviewer types a number, picking stars no longer overwrites it.
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '45' } });
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Stars on the screenshot' })).getByRole('radio', { name: '5 stars' }));
    expect(screen.getByRole('spinbutton')).toHaveValue(45);
  });

  test('verify sends stars, points and the version it was looking at', async () => {
    verifyMutate.mockResolvedValue(review({ status: 'verified', stars: 5, points: 50, version: 1 }));
    const { onDone } = open(review());
    fireEvent.click(screen.getByRole('button', { name: 'Verify and add points' }));
    await waitFor(() => expect(verifyMutate).toHaveBeenCalledWith({ id: 'g1', stars: 5, points: 50, expectedVersion: 0 }));
    expect(onDone).toHaveBeenCalledWith('Verified — +50 pts to Nevin P Vinu.');
  });

  test('points above the maximum are refused before sending', async () => {
    open(review());
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '150' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and add points' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('1 to 100');
    expect(verifyMutate).not.toHaveBeenCalled();
  });

  test('someone else changed it: the server\'s message is shown, nothing is assumed', async () => {
    verifyMutate.mockRejectedValue(Object.assign(new Error('x'), { rawData: { message: 'Someone else just changed this review. Refresh to see the latest.' } }));
    const { onDone } = open(review());
    fireEvent.click(screen.getByRole('button', { name: 'Verify and add points' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Someone else just changed');
    expect(onDone).not.toHaveBeenCalled();
  });

  test('reject needs a reason', async () => {
    rejectMutate.mockResolvedValue(review({ status: 'rejected', version: 1 }));
    const { onDone } = open(review());
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Write the reason');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Not our Google page' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(rejectMutate).toHaveBeenCalledWith({ id: 'g1', reason: 'Not our Google page', expectedVersion: 0 }));
    expect(onDone).toHaveBeenCalledWith('Rejected.');
  });

  test('a verified review offers "Save new points" and "Unverify" (points taken back)', async () => {
    rejectMutate.mockResolvedValue(review({ status: 'rejected', version: 2 }));
    const { onDone } = open(review({ status: 'verified', stars: 5, points: 50, version: 1, reviewedByName: 'Mkt Head' }));
    expect(screen.getByRole('spinbutton')).toHaveValue(50);
    expect(screen.getByRole('button', { name: 'Save new points' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Unverify' }));
    expect(screen.getByText(/The 50 pts will be taken back/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Review deleted' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unverify' }));
    await waitFor(() => expect(rejectMutate).toHaveBeenCalledWith({ id: 'g1', reason: 'Review deleted', expectedVersion: 1 }));
    expect(onDone).toHaveBeenCalledWith('Unverified — the 50 pts were taken back.');
  });

  test('your own submission cannot be checked by you', () => {
    open(review(), 'u-nevin');
    expect(screen.getByText(/your own submission/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Verify and add points' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
  });

  test('buttons are disabled while saving (no double submit)', () => {
    pending.verify = true;
    open(review());
    expect(screen.getByRole('button', { name: /Verify and add points/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();
  });

  test('the screenshot shows "Loading…" until it arrives, and a message if it fails', () => {
    const { unmount } = render(<ReviewDecision initial={review()} policy={policy} meId="u-mkt" onClose={jest.fn()} onDone={jest.fn()} />);
    const img = screen.getByAltText(/Screenshot of the review/);
    expect(screen.getByText('Loading screenshot…')).toBeInTheDocument();
    fireEvent.load(img);
    expect(screen.queryByText('Loading screenshot…')).not.toBeInTheDocument();
    unmount();
    render(<ReviewDecision initial={review()} policy={policy} meId="u-mkt" onClose={jest.fn()} onDone={jest.fn()} />);
    fireEvent.error(screen.getByAltText(/Screenshot of the review/));
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the screenshot');
  });

  test('Escape closes the dialog', () => {
    const { onClose } = open(review());
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('ReviewList', () => {
  test('loading, then empty', () => {
    listQ = { isLoading: true };
    const { rerender } = render(<ReviewList mode="queue" onOpen={jest.fn()} />);
    expect(screen.getByLabelText('Loading reviews')).toBeInTheDocument();
    listQ = { data: { pages: [{ reviews: [], nextCursor: null, pendingCount: 0 }] } };
    rerender(<ReviewList mode="queue" onOpen={jest.fn()} />);
    expect(screen.getByText(/Nothing waiting/)).toBeInTheDocument();
  });

  test('rows with status, points and history; pending badge; Load more', () => {
    const fetchNextPage = jest.fn();
    const onOpen = jest.fn();
    listQ = {
      data: { pages: [{ reviews: [review(), review({ id: 'g2', status: 'verified', stars: 4, points: 30, creditMonth: '2026-11' })], nextCursor: 'c', pendingCount: 1 }] },
      hasNextPage: true, fetchNextPage,
    };
    render(<ReviewList mode="queue" onOpen={onOpen} />);
    expect(screen.getByRole('tab', { name: /Pending/ })).toHaveTextContent('1');
    expect(screen.getAllByText('Waiting for check').length).toBeGreaterThan(0);
    expect(screen.getByText(/\+30 pts/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'g1' }));
    fireEvent.click(screen.getAllByRole('button', { name: /History/ })[0]);
    expect(screen.getByText('Sent by Nevin P Vinu — said 5★')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(fetchNextPage).toHaveBeenCalled();
  });

  test('an error is shown, not an empty list', () => {
    listQ = { error: Object.assign(new Error('x'), { rawData: { message: 'Only the marketing head or an admin can see all Google reviews.' } }) };
    render(<ReviewList mode="queue" onOpen={jest.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Only the marketing head');
  });
});

describe('helpers', () => {
  test('suggestedPoints follows the scale', () => {
    expect(suggestedPoints(policy, 5)).toBe(50);
    expect(suggestedPoints(policy, 3)).toBe(0);
    expect(suggestedPoints(policy, null)).toBe(0);
  });
  test('describeHistory in plain words', () => {
    expect(describeHistory({ action: 'points_changed', at: '', byName: 'Admin', stars: 4, points: 30, deltaPoints: -20, month: '2026-11', reason: '' }))
      .toBe('Points changed by Admin — 4★, -20 pts, now 30 pts');
    expect(describeHistory({ action: 'unverified', at: '', byName: 'Mkt Head', stars: null, points: 0, deltaPoints: -30, month: '2026-12', reason: 'Deleted' }))
      .toBe('Unverified by Mkt Head — -30 pts, “Deleted”');
  });
  test('screenshotProblem', () => {
    expect(screenshotProblem(null, 100)).toMatch(/Attach/);
    expect(screenshotProblem(png('a.gif', 'image/gif'), 1e7)).toMatch(/JPG/);
    expect(screenshotProblem(png(), 1e7)).toBe('');
  });
});
