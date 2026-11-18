/**
 * A project's Money box. The server sums the money and decides who sees it
 * (Back-end tests/projectMoney.test.js); these pin what the screen shows: the
 * server's totals as given, the rows and their links, paging, and no box (and
 * no request) for a member.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AuthContext from '@/context/AuthContext';
import { mayShowMoney, paymentHref, ProjectMoney, type MoneyPage, type MoneyRow } from './ProjectMoney';
import type { Project } from './types';

const get = jest.fn();
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => get(...a), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
let me: { _id: string; role: string; staff: { team: string; active: boolean } | null } | null = null;
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => <a href={href} className={className}>{children}</a>,
}));

type Ctx = React.ContextType<typeof AuthContext>;
const wrap = (ui: React.ReactElement) => render(
  <AuthContext.Provider value={{ user: me } as unknown as Ctx}>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
  </AuthContext.Provider>,
);

const project = { id: 'p1', code: 'PRJ-0001', name: "Vicky's Hilux", owner: { id: 'u-owner', name: 'Hari' } } as unknown as Project;
const row = (over: Partial<MoneyRow> = {}): MoneyRow => ({
  id: 'r1', number: 'PR-0001', kind: 'expense', status: 'paid', category: 'fuel', categoryLabel: 'Fuel',
  purpose: 'Diesel for the van', amount: 1500, currency: 'INR', foreignAmount: null, payee: 'Fuel Station',
  createdAt: '2026-11-10T06:00:00.000Z', paidAt: null, canOpen: true, ...over,
});
const firstPage = (over: Partial<MoneyPage> = {}): MoneyPage => ({
  project: { id: 'p1', code: 'PRJ-0001', name: "Vicky's Hilux", archived: false },
  totals: { paid: { count: 6, amount: 14200 }, waiting: { count: 1, amount: 500 }, closed: { count: 1 } },
  payments: { items: [row(), row({ id: 'r2', number: 'PR-0002', status: 'submitted', amount: 500, purpose: 'Seat covers', canOpen: false })], nextCursor: null },
  ...over,
});

beforeEach(() => { get.mockReset(); me = null; });

describe('ProjectMoney', () => {
  it('shows the server’s totals as given, and each payment with its link', async () => {
    me = { _id: 'u-owner', role: 'staff', staff: { team: 'operations', active: true } };
    get.mockResolvedValueOnce(firstPage());
    wrap(<ProjectMoney p={project} isAdmin={false} />);

    expect(await screen.findByTestId('money-spent')).toHaveTextContent('Spent ₹14,200');
    expect(screen.getByText('6 payments paid')).toBeInTheDocument();
    expect(screen.getByTestId('money-waiting')).toHaveTextContent('Waiting ₹500');
    expect(screen.getByText(/1 not paid yet · 1 declined or cancelled/)).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/staff/tasks/projects/p1/payments');

    const list = screen.getByRole('list', { name: 'Linked payments' });
    const [paid, waiting] = within(list).getAllByRole('listitem');
    expect(paid).toHaveTextContent('Diesel for the van');
    expect(paid).toHaveTextContent('Fuel · Fuel Station');
    expect(paid).toHaveTextContent('Paid');
    expect(paid).toHaveTextContent('₹1,500');
    expect(within(paid).getByRole('link', { name: 'Open PR-0001' })).toHaveAttribute('href', '/team/payments?status=all&q=PR-0001');
    // Another team's payment: shown, but not a link this person could not open.
    expect(waiting).toHaveTextContent('Waiting');
    expect(within(waiting).queryByRole('link')).toBeNull();
  });

  it('a member gets no box and no request', () => {
    me = { _id: 'u-member', role: 'staff', staff: { team: 'procurement', active: true } };
    const { container } = wrap(<ProjectMoney p={project} isAdmin={false} />);
    expect(container).toBeEmptyDOMElement();
    expect(get).not.toHaveBeenCalled();
  });

  it('with no sign-in context at all (a preview), there is no box and no request', () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}><ProjectMoney p={project} isAdmin /></QueryClientProvider>,
    );
    expect(container).toBeEmptyDOMElement();
    expect(get).not.toHaveBeenCalled();
  });

  it('who the box is for: the admin, Accounts and the owner', () => {
    expect(mayShowMoney({ _id: 'a', role: 'admin', staff: null }, project)).toBe(true);
    expect(mayShowMoney({ _id: 'x', role: 'staff', staff: { team: 'accounts', active: true } }, project)).toBe(true);
    expect(mayShowMoney({ _id: 'u-owner', role: 'staff', staff: { team: 'sales', active: true } }, project)).toBe(true);
    expect(mayShowMoney({ _id: 'u-owner', role: 'staff', staff: { team: 'sales', active: false } }, project)).toBe(false);
    expect(mayShowMoney({ _id: 'y', role: 'staff', staff: { team: 'sales', active: true } }, project)).toBe(false);
    expect(mayShowMoney(null, project)).toBe(false);
    expect(paymentHref({ number: 'PR-0009' }, true)).toBe('/admin/payments?view=all&status=all&q=PR-0009');
  });

  it('pages with the server’s cursor, and the totals stay those of the first page', async () => {
    me = { _id: 'a', role: 'admin', staff: null };
    get
      .mockResolvedValueOnce(firstPage({ payments: { items: [row()], nextCursor: 'CUR 1' } }))
      .mockResolvedValueOnce({ payments: { items: [row({ id: 'r9', number: 'PR-0009', purpose: 'Old tyres' })], nextCursor: null } });
    wrap(<ProjectMoney p={project} isAdmin />);

    fireEvent.click(await screen.findByRole('button', { name: /Show more/ }));
    expect(await screen.findByText('Old tyres')).toBeInTheDocument();
    expect(get).toHaveBeenLastCalledWith('/staff/tasks/projects/p1/payments?cursor=CUR%201');
    expect(screen.getByTestId('money-spent')).toHaveTextContent('Spent ₹14,200');
    expect(screen.queryByRole('button', { name: /Show more/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Open PR-0001' })).toHaveAttribute('href', '/admin/payments?view=all&status=all&q=PR-0001');
  });

  it('an empty project says how to link a payment', async () => {
    me = { _id: 'a', role: 'admin', staff: null };
    get.mockResolvedValueOnce(firstPage({
      totals: { paid: { count: 0, amount: 0 }, waiting: { count: 0, amount: 0 }, closed: { count: 0 } },
      payments: { items: [], nextCursor: null },
    }));
    wrap(<ProjectMoney p={project} isAdmin />);
    expect(await screen.findByText(/No payments yet/)).toHaveTextContent('PRJ-0001');
    expect(screen.getByTestId('money-spent')).toHaveTextContent('Spent ₹0');
  });

  it('a refusal or failure shows the server’s message, never made-up numbers', async () => {
    me = { _id: 'u-owner', role: 'staff', staff: { team: 'operations', active: true } };
    get.mockRejectedValueOnce({ rawData: { message: 'Only the project owner, Accounts and the admin see a project’s money.' } });
    wrap(<ProjectMoney p={project} isAdmin={false} />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Only the project owner'));
    expect(screen.queryByTestId('money-spent')).toBeNull();
  });
});
