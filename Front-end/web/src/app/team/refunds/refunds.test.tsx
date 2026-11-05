/**
 * The Accounts Refunds page: two tabs over the two lists that used to be two
 * menu items. The lists themselves are the existing components (their own tests
 * cover them); this file checks the tabs, the counts, the address, and that the
 * old /team/return-refunds link still lands on the right tab.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import RefundsTabs, { tabFrom } from './RefundsTabs';
import ReturnRefundsMoved from '../return-refunds/page';

let search = '';
const replace = jest.fn();
const redirect = jest.fn();
jest.mock('next/navigation', () => ({
  usePathname: () => '/team/refunds',
  useRouter: () => ({ replace, push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(search),
  redirect: (to: string) => redirect(to),
}));
let items: { key: string; label: string; count: number; href: string }[] = [];
jest.mock('@/hooks/queries/useNotifications', () => ({ useWaitingWork: () => ({ data: { items, total: 0 } }) }));
const workQueue = jest.fn();
jest.mock('@/components/staff/work/WorkQueueList', () => ({
  __esModule: true,
  default: (p: { queue: string }) => { workQueue(p); return <p>work queue: {p.queue}</p>; },
}));
const returnList = jest.fn();
jest.mock('@/components/staff/returns/ReturnsBoard', () => ({
  ReturnList: (p: { queue: string; showRefund?: boolean }) => { returnList(p); return <p>return list: {p.queue}</p>; },
}));

beforeEach(() => { search = ''; items = []; jest.clearAllMocks(); });

it('opens on "Cancelled orders" — the refund approvals list, unchanged', () => {
  render(<RefundsTabs />);
  expect(screen.getByRole('tab', { name: /Cancelled orders/ })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tab', { name: /Returned items/ })).toHaveAttribute('aria-selected', 'false');
  expect(screen.getByText('work queue: refunds')).toBeInTheDocument();
  expect(workQueue).toHaveBeenCalledWith({ queue: 'refunds' });
  expect(returnList).not.toHaveBeenCalled();
});

it('?tab=returns shows "Returned items" — the return refunds list, unchanged', () => {
  search = 'tab=returns';
  render(<RefundsTabs />);
  expect(screen.getByRole('tab', { name: /Returned items/ })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByText('return list: refund')).toBeInTheDocument();
  expect(returnList).toHaveBeenCalledWith({ queue: 'refund', showRefund: true });
  expect(workQueue).not.toHaveBeenCalled();
});

it('switching tabs writes the tab into the address and drops the other list\'s filters', () => {
  search = 'q=abc&sort=oldest';
  render(<RefundsTabs />);
  fireEvent.click(screen.getByRole('tab', { name: /Returned items/ }));
  expect(replace).toHaveBeenCalledWith('/team/refunds?tab=returns', { scroll: false });
  fireEvent.click(screen.getByRole('tab', { name: /Cancelled orders/ }));
  expect(replace).toHaveBeenLastCalledWith('/team/refunds?tab=cancelled', { scroll: false });
});

it('each tab shows how many are waiting, from the same numbers as the bell', () => {
  items = [
    { key: 'refunds_to_send', label: 'Refunds to send', count: 3, href: '/team/refunds' },
    { key: 'returns_refund', label: 'Return refunds to send', count: 0, href: '/team/refunds?tab=returns' },
  ];
  render(<RefundsTabs />);
  expect(screen.getByRole('tab', { name: /Cancelled orders/ })).toHaveTextContent('3');
  expect(screen.getByLabelText('3 waiting')).toBeInTheDocument();
  expect(screen.getByLabelText('0 waiting')).toBeInTheDocument();
});

it('no count yet (still loading, or not this person\'s queue) shows no number rather than a wrong 0', () => {
  render(<RefundsTabs />);
  expect(screen.queryByLabelText(/waiting/)).toBeNull();
});

it('an unknown or missing tab falls back to Cancelled orders', () => {
  expect(tabFrom(null)).toBe('cancelled');
  expect(tabFrom('refund')).toBe('cancelled');
  expect(tabFrom('returns')).toBe('returns');
  expect(tabFrom('cancelled')).toBe('cancelled');
});

it('the old /team/return-refunds link redirects to the Returned items tab', () => {
  ReturnRefundsMoved();
  expect(redirect).toHaveBeenCalledWith('/team/refunds?tab=returns');
});
