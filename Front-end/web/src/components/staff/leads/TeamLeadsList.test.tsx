/**
 * The GTM leads sheet: who-is-following-up on each row, the Follow up button,
 * losing the race (409 with the lead → the card shows who has it, no error page),
 * view-only members, phone numbers only where the server sends them, and paging.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TeamLeadsList, { type TeamLead } from './TeamLeadsList';
import { addressBar } from '@/test-utils/addressBarMock';

jest.mock('next/navigation', () => jest.requireActual('@/test-utils/addressBarMock').nextNavigation);
const get = jest.fn();
const post = jest.fn();
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) } }));

const LEAD = (over: Partial<TeamLead> = {}): TeamLead => ({
  id: 'l1', name: 'Ravi Kumar', status: 'new', score: 82, source: 'payment_failed',
  detail: { total: 18400, itemCount: 2, productName: null, makeModel: null, city: null, orderNumber: null },
  hasPurchased: false, returning: false, createdAt: '2026-11-05T10:00:00.000Z', lastUpdateAt: null,
  followingUp: null, quietDays: 0, contact: null, ...over,
});
const YOU = { canFollowUp: true, canReassign: false, repId: 'r1' };
const PEOPLE = { people: [{ repId: 'r1', name: 'Priya' }, { repId: 'r2', name: 'Arjun' }] };

type You = { canFollowUp: boolean; canReassign: boolean; repId: string | null };
/** The list the "server" holds; a write test swaps in the server's new state, as the real one would. */
let pagesNow: { leads: TeamLead[]; nextCursor: string | null }[] = [];
function serve(pages: { leads: TeamLead[]; nextCursor: string | null }[], you: You = YOU) {
  pagesNow = pages;
  get.mockImplementation((url: string) => {
    if (url === '/staff/leads/people') return Promise.resolve(PEOPLE);
    const cursor = new URLSearchParams(url.split('?')[1]).get('cursor');
    const i = cursor ? Number(cursor) : 0;
    return Promise.resolve({ ...pagesNow[i], you });
  });
}
const listCalls = () => get.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith('/staff/leads?'));
const renderList = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><TeamLeadsList /></QueryClientProvider>,
);

beforeEach(() => {
  addressBar.reset('/team/leads');
  get.mockReset();
  post.mockReset();
});

it('shows every lead, who is following up, and a Follow up button on free ones', async () => {
  serve([{ leads: [LEAD(), LEAD({ id: 'l2', name: 'Sita Mehta', followingUp: { repId: 'r2', name: 'Arjun', at: '2026-11-06T09:42:00.000Z', mine: false } })], nextCursor: null }]);
  renderList();
  const cards = await screen.findAllByTestId('lead-card');
  expect(within(cards[0]).getByRole('button', { name: /Follow up/ })).toBeInTheDocument();
  expect(within(cards[0]).getByText(/₹18,400 · 2 items/)).toBeInTheDocument();
  expect(within(cards[1]).getByText('Following up: Arjun')).toBeInTheDocument();
  expect(within(cards[1]).queryByRole('button', { name: /Follow up/ })).not.toBeInTheDocument();
  expect(new URLSearchParams(listCalls()[0].split('?')[1]).get('view')).toBe('all');
});

it('Follow up: the card changes only to what the server confirms', async () => {
  serve([{ leads: [LEAD()], nextCursor: null }]);
  const mine = LEAD({ followingUp: { repId: 'r1', name: 'Priya', at: '2026-11-06T10:00:00.000Z', mine: true }, contact: { phone: '9876543210', email: null } });
  post.mockImplementation(() => { pagesNow = [{ leads: [mine], nextCursor: null }]; return Promise.resolve({ success: true, outcome: 'claimed', lead: mine }); });
  renderList();
  fireEvent.click(await screen.findByRole('button', { name: /Follow up/ }));
  await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/leads/l1/follow-up', {}));
  expect(await screen.findByText('Following up: You')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /9876543210/ })).toHaveAttribute('href', 'tel:9876543210');
  expect(screen.getByRole('button', { name: /Stop following up/ })).toBeInTheDocument();
});

it('losing the race shows who got it — not an error', async () => {
  serve([{ leads: [LEAD()], nextCursor: null }]);
  const arjuns = LEAD({ followingUp: { repId: 'r2', name: 'Arjun', at: '2026-11-06T10:00:00.000Z', mine: false } });
  post.mockImplementation(() => {
    pagesNow = [{ leads: [arjuns], nextCursor: null }];
    return Promise.reject({ status: 409, rawData: { success: false, outcome: 'taken', message: 'Arjun is already following up on this lead.', lead: arjuns } });
  });
  renderList();
  fireEvent.click(await screen.findByRole('button', { name: /Follow up/ }));
  expect(await screen.findByRole('status')).toHaveTextContent('Arjun is already following up on this lead.');
  expect(screen.getByText('Following up: Arjun')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Follow up/ })).not.toBeInTheDocument();
});

it('members who cannot take leads see the sheet without the button', async () => {
  serve([{ leads: [LEAD()], nextCursor: null }], { canFollowUp: false, canReassign: false, repId: null });
  renderList();
  expect(await screen.findByText('Free — nobody yet')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Follow up/ })).not.toBeInTheDocument();
  expect(screen.getByText(/The GTM head and GTM leads take leads/)).toBeInTheDocument();
});

it('flags a lead with no update for a week', async () => {
  serve([{ leads: [LEAD({ followingUp: { repId: 'r2', name: 'Arjun', at: '2026-10-20T10:00:00.000Z', mine: false }, quietDays: 9 })], nextCursor: null }]);
  renderList();
  expect(await screen.findByText(/No update for 9 days/)).toBeInTheDocument();
});

it('"Mine", "Free" and a person ask the server for that view', async () => {
  serve([{ leads: [LEAD()], nextCursor: null }]);
  renderList();
  await screen.findAllByTestId('lead-card');
  fireEvent.click(screen.getByRole('tab', { name: 'Mine' }));
  await waitFor(() => expect(addressBar.replace).toHaveBeenLastCalledWith('/team/leads?view=mine', { scroll: false }));
  await waitFor(() => expect(new URLSearchParams(listCalls().at(-1)!.split('?')[1]).get('view')).toBe('mine'));
  fireEvent.change(await screen.findByLabelText('Person'), { target: { value: 'r2' } });
  await waitFor(() => {
    const p = new URLSearchParams(listCalls().at(-1)!.split('?')[1]);
    expect([p.get('view'), p.get('rep')]).toEqual(['person', 'r2']);
  });
});

it('"Show more" loads the next page by cursor', async () => {
  serve([{ leads: [LEAD()], nextCursor: '1' }, { leads: [LEAD({ id: 'l2', name: 'Sita Mehta' })], nextCursor: null }]);
  renderList();
  fireEvent.click(await screen.findByRole('button', { name: 'Show more' }));
  expect(await screen.findByText('Sita Mehta')).toBeInTheDocument();
  expect(new URLSearchParams(listCalls().at(-1)!.split('?')[1]).get('cursor')).toBe('1');
  expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
});

describe('which product', () => {
  it('names each product with variant and qty; a deleted one reads "Product removed"', async () => {
    serve([{ leads: [LEAD({ detail: {
      total: 15980, itemCount: 2, productName: null, makeModel: null, city: null, orderNumber: null,
      items: [
        { name: 'Pioneer SPH-10BT', variantLabel: 'Black', quantity: 1, removed: false },
        { name: null, variantLabel: null, quantity: 2, removed: true },
      ],
    } })], nextCursor: null }]);
    renderList();
    const products = await screen.findByRole('list', { name: 'Products' });
    expect(within(products).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Pioneer SPH-10BT — Black × 1', 'Product removed × 2',
    ]);
    expect(screen.getByText(/₹15,980 · 2 items/)).toBeInTheDocument();
  });

  it('a card from an older server (no items) still shows its one-line summary', async () => {
    serve([{ leads: [LEAD()], nextCursor: null }]);
    renderList();
    expect(await screen.findByText(/₹18,400 · 2 items/)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Products' })).not.toBeInTheDocument();
  });
});

describe('follow-up status', () => {
  const MINE = { repId: 'r1', name: 'Nevin', at: '2026-11-06T10:00:00.000Z', mine: true };

  it('taking a lead opens "How did it go?" straight away', async () => {
    serve([{ leads: [LEAD()], nextCursor: null }]);
    const mine = LEAD({ followingUp: MINE });
    post.mockImplementation(() => { pagesNow = [{ leads: [mine], nextCursor: null }]; return Promise.resolve({ success: true, outcome: 'claimed', lead: mine }); });
    renderList();
    fireEvent.click(await screen.findByRole('button', { name: /Follow up/ }));
    expect(await screen.findByRole('radiogroup', { name: 'Follow-up status' })).toBeInTheDocument();
    expect(within(screen.getByRole('radiogroup')).getAllByRole('radio').map((r) => r.textContent)).toEqual([
      'Responded', 'WhatsApp', 'Converted', 'No response', 'Not interested', 'Others',
    ]);
  });

  it('"Others" cannot be saved without text; with text it posts status + note and shows the badge', async () => {
    serve([{ leads: [LEAD({ followingUp: MINE })], nextCursor: null }]);
    const saved = LEAD({ followingUp: MINE, followUpStatus: { status: 'other', label: 'Others', at: '2026-11-07T10:00:00.000Z' } });
    post.mockImplementation(() => { pagesNow = [{ leads: [saved], nextCursor: null }]; return Promise.resolve({ success: true, outcome: 'saved', lead: saved }); });
    renderList();
    fireEvent.click(await screen.findByRole('button', { name: /Update follow-up/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'Others' }));
    const save = screen.getByRole('button', { name: /Save follow-up/ });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/What happened\? \(required\)/), { target: { value: '   ' } });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/What happened\? \(required\)/), { target: { value: ' Call after Diwali ' } });
    fireEvent.click(save);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/leads/l1/follow-ups', { status: 'other', note: 'Call after Diwali' }));
    expect(await screen.findByText('Others', { selector: 'span' })).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('a note is optional for the other statuses', async () => {
    serve([{ leads: [LEAD({ followingUp: MINE })], nextCursor: null }]);
    const saved = LEAD({ followingUp: MINE, followUpStatus: { status: 'no_response', label: 'No response', at: null } });
    post.mockResolvedValue({ success: true, outcome: 'saved', lead: saved });
    renderList();
    fireEvent.click(await screen.findByRole('button', { name: /Update follow-up/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'No response' }));
    fireEvent.click(screen.getByRole('button', { name: /Save follow-up/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/leads/l1/follow-ups', { status: 'no_response', note: '' }));
  });

  it('a server refusal is shown, and nothing changes on the card', async () => {
    serve([{ leads: [LEAD({ followingUp: MINE })], nextCursor: null }]);
    post.mockRejectedValue({ status: 403, message: 'Only the person following up, the GTM head or admin can update this lead.' });
    renderList();
    fireEvent.click(await screen.findByRole('button', { name: /Update follow-up/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'Responded' }));
    fireEvent.click(screen.getByRole('button', { name: /Save follow-up/ }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
  });

  it('no "Update follow-up" for someone else\'s lead, or for viewers', async () => {
    serve([{ leads: [LEAD({ followingUp: { ...MINE, name: 'Arjun', mine: false } })], nextCursor: null }]);
    renderList();
    await screen.findByText('Following up: Arjun');
    expect(screen.queryByRole('button', { name: /Update follow-up/ })).not.toBeInTheDocument();
  });

  it('the Follow-up filter asks the server for that status', async () => {
    serve([{ leads: [LEAD()], nextCursor: null }]);
    renderList();
    fireEvent.change(await screen.findByLabelText('Follow-up'), { target: { value: 'no_response' } });
    await waitFor(() => expect(new URLSearchParams(listCalls().at(-1)!.split('?')[1]).get('followUp')).toBe('no_response'));
  });
});
