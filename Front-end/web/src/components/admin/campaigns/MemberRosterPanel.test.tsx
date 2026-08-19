import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MemberRosterPanel from './MemberRosterPanel';
import apiClient from '@/lib/api';

/**
 * The roster is the answer to "is this customer on the list, and did they use it?".
 * These pin the two things that make it trustworthy: it pages with a KEYSET cursor
 * (so nobody is shown twice or skipped while imports land), and the whole-campaign
 * counts never get replaced by the counts of a filtered page.
 */
jest.mock('@/lib/api', () => ({ __esModule: true, default: { get: jest.fn() } }));

const get = apiClient.get as jest.Mock;

const member = (email: string, over = {}) => ({
  _id: email, email, name: email.split('@')[0], status: 'invited',
  claimedAt: null, redeemedAt: null, discountRupees: 0, reviewNote: null, ...over,
});

const renderPanel = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemberRosterPanel campaignId="c1" />
    </QueryClientProvider>,
  );
};

beforeEach(() => get.mockReset());

describe('MemberRosterPanel', () => {
  it('lists the people and the campaign total', async () => {
    get.mockResolvedValue({
      members: [member('a@x.com'), member('b@x.com')],
      nextCursor: null,
      counts: { invited: 2, claimed: 0, redeemed: 0, total: 2 },
    });

    renderPanel();

    expect(await screen.findByText('a@x.com')).toBeInTheDocument();
    expect(screen.getByText('b@x.com')).toBeInTheDocument();
    expect(screen.getByText(/2 people/)).toBeInTheDocument();
  });

  it('appends the next page instead of replacing the current one', async () => {
    get.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('cursor=')
          ? { members: [member('b@x.com')], nextCursor: null, counts: null }
          : { members: [member('a@x.com')], nextCursor: 'a@x.com', counts: { invited: 2, claimed: 0, redeemed: 0, total: 2 } },
      ),
    );

    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /show more/i }));

    // Both pages on screen at once — "show more" must extend the list, not swap it.
    await waitFor(() => expect(screen.getByText('b@x.com')).toBeInTheDocument());
    expect(screen.getByText('a@x.com')).toBeInTheDocument();
  });

  it('asks the server for the next page by cursor, never by offset', async () => {
    get.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('cursor=')
          ? { members: [], nextCursor: null, counts: null }
          : { members: [member('a@x.com')], nextCursor: 'a@x.com', counts: { invited: 1, claimed: 0, redeemed: 0, total: 1 } },
      ),
    );

    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /show more/i }));

    await waitFor(() => {
      const urls = get.mock.calls.map((c) => c[0] as string);
      expect(urls.some((u) => u.includes('cursor=a%40x.com'))).toBe(true);
      expect(urls.every((u) => !u.includes('page=') && !u.includes('skip='))).toBe(true);
    });
  });

  it('debounces typing into one request rather than one per keystroke', async () => {
    jest.useFakeTimers();
    get.mockResolvedValue({ members: [], nextCursor: null, counts: { invited: 0, claimed: 0, redeemed: 0, total: 0 } });

    renderPanel();
    const box = screen.getByPlaceholderText(/search by name or email/i);
    fireEvent.change(box, { target: { value: 'aa' } });
    fireEvent.change(box, { target: { value: 'aaf' } });
    fireEvent.change(box, { target: { value: 'aafaz' } });

    // The operator's text is never overwritten by an in-flight response.
    expect((box as HTMLInputElement).value).toBe('aafaz');

    act(() => { jest.advanceTimersByTime(400); });
    jest.useRealTimers();

    await waitFor(() => {
      const urls = get.mock.calls.map((c) => c[0] as string);
      expect(urls.some((u) => u.includes('q=aafaz'))).toBe(true);
      // The intermediate keystrokes must not each have hit the API.
      expect(urls.filter((u) => u.includes('q=aa&') || u.includes('q=aaf&'))).toHaveLength(0);
    });
  });

  it('restarts paging when a filter changes, so stale pages cannot leak through', async () => {
    get.mockResolvedValue({
      members: [member('a@x.com')], nextCursor: 'a@x.com',
      counts: { invited: 1, claimed: 0, redeemed: 0, total: 1 },
    });

    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /show more/i }));
    await waitFor(() => expect(get.mock.calls.some((c) => (c[0] as string).includes('cursor='))).toBe(true));

    get.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /used it/i }));

    await waitFor(() => {
      const urls = get.mock.calls.map((c) => c[0] as string);
      expect(urls.some((u) => u.includes('status=redeemed'))).toBe(true);
      // A filtered list starts at page one; carrying the old cursor would hide rows.
      expect(urls.every((u) => !u.includes('cursor='))).toBe(true);
    });
  });

  it('never shows an operator the raw database word for a status', async () => {
    get.mockResolvedValue({
      members: [
        member('a@x.com', { status: 'invited' }),
        member('b@x.com', { status: 'claimed' }),
        member('c@x.com', { status: 'redeemed' }),
      ],
      nextCursor: null,
      counts: { invited: 1, claimed: 1, redeemed: 1, total: 3 },
    });

    renderPanel();
    await screen.findByText('a@x.com');

    // Plain English in the table, matching the filter buttons exactly. "claimed" is
    // schema vocabulary and must not surface — it is what prompted "what does the
    // claimed status mean?" in the first place.
    expect(screen.queryByText('claimed')).not.toBeInTheDocument();
    expect(screen.queryByText('invited')).not.toBeInTheDocument();
    expect(screen.queryByText('redeemed')).not.toBeInTheDocument();

    // Two of each label: one filter button, one table chip.
    expect(screen.getAllByText('Signed in')).toHaveLength(2);
    expect(screen.getAllByText('Not signed in')).toHaveLength(2);
    expect(screen.getAllByText('Used it')).toHaveLength(2);
  });

  it('prints the review note rather than hiding it behind a hover tooltip', async () => {
    get.mockResolvedValue({
      members: [member('a@x.com', { reviewNote: 'CHECK IDENTITY - email may belong to a dealer' })],
      nextCursor: null,
      counts: { invited: 1, claimed: 0, redeemed: 0, total: 1 },
    });

    renderPanel();

    // Visible text, not a title attribute: this is the one thing an operator must
    // act on before a card goes in the post, and hover reaches neither phone nor
    // keyboard.
    expect(await screen.findByText(/CHECK IDENTITY/)).toBeVisible();
  });

  it('says so plainly when a search matches nobody', async () => {
    get.mockResolvedValue({ members: [], nextCursor: null, counts: { invited: 5, claimed: 0, redeemed: 0, total: 5 } });
    renderPanel();
    fireEvent.change(screen.getByPlaceholderText(/search by name or email/i), { target: { value: 'zzz' } });
    expect(await screen.findByText(/nobody matches that/i)).toBeInTheDocument();
  });

  it('surfaces a failed load instead of showing an empty list', async () => {
    get.mockRejectedValue(new Error('Campaign not found'));
    renderPanel();
    expect(await screen.findByText(/could not load the list/i)).toBeInTheDocument();
  });
});
