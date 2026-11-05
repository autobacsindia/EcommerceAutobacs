/**
 * Procurement's one "Orders" page: "To do" (its work queue) and "All in progress"
 * (every paid order being worked — what used to be a second menu item).
 */
import { fireEvent, render, screen } from '@testing-library/react';
import Page from './page';

let search = '';
const replace = jest.fn((url: string) => { search = url.split('?')[1] || ''; });
jest.mock('next/navigation', () => ({
  usePathname: () => '/team/procurement',
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(search),
}));
jest.mock('@/components/staff/work/WorkQueueList', () => ({ __esModule: true, default: ({ queue }: { queue: string }) => <p>queue:{queue}</p> }));
jest.mock('@/components/staff/sales/SalesOrdersList', () => ({ __esModule: true, default: ({ mode, stage }: { mode: string; stage: string }) => <p>list:{mode}:{stage}</p> }));

beforeEach(() => { search = ''; replace.mockClear(); });

it('opens on "To do" — procurement’s own queue', () => {
  render(<Page />);
  expect(screen.getByRole('tab', { name: 'To do' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByText('queue:procurement')).toBeInTheDocument();
});

it('"All in progress" is the order-processing list, kept in the address', () => {
  const { rerender } = render(<Page />);
  fireEvent.click(screen.getByRole('tab', { name: 'All in progress' }));
  expect(replace).toHaveBeenCalledWith('/team/procurement?list=all', { scroll: false });
  rerender(<Page />);
  expect(screen.getByText('list:paid:processing')).toBeInTheDocument();
  expect(screen.queryByText('queue:procurement')).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: 'To do' }));
  expect(replace).toHaveBeenLastCalledWith('/team/procurement', { scroll: false });
});
