/**
 * The "new work" pop-up card in the panel: one card per new task / project
 * added, with the sound once, remembered across pages and tabs once closed.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { WorkAlert } from '@/hooks/queries/useNotifications';
import NewWorkPopup, { SEEN_KEY, SHOWN_MAX } from './NewWorkPopup';

let alerts: WorkAlert[] = [];
jest.mock('@/hooks/queries/useNotifications', () => ({
  useWaitingWork: () => ({ data: { items: [], total: 0, alerts } }),
}));
const playAlert = jest.fn();
jest.mock('@/lib/notificationChime', () => ({ alert: () => playAlert() }));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a>,
}));

const ADDED: WorkAlert = {
  id: 'a1', kind: 'project_added', by: 'Vicky', title: 'Vicky’s Hilux', text: 'deadline 2026-11-28',
  href: '/team/tasks?view=project&project=p1', at: '2026-11-21T04:00:00.000Z',
};
const TASK: WorkAlert = {
  id: 'a2', kind: 'assigned', by: 'Vicky', title: 'T-42 · Fit roof rack', text: 'due 2026-11-25',
  href: '/team/tasks/t42', at: '2026-11-21T04:01:00.000Z',
};

beforeEach(() => {
  localStorage.clear();
  playAlert.mockReset();
  alerts = [];
});

it('Nevin is added to “Vicky’s Hilux”: a card says so, with the sound, and opens the project', async () => {
  alerts = [ADDED];
  render(<NewWorkPopup />);
  expect(await screen.findByText('Vicky added you to a project')).toBeInTheDocument();
  expect(screen.getByText('Vicky’s Hilux')).toBeInTheDocument();
  expect(screen.getByText('deadline 28 Nov')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open project' })).toHaveAttribute('href', '/team/tasks?view=project&project=p1');
  expect(playAlert).toHaveBeenCalledTimes(1);
});

it('a new task reads “New task from …”, with its due day', async () => {
  alerts = [TASK];
  render(<NewWorkPopup />);
  expect(await screen.findByText('New task from Vicky')).toBeInTheDocument();
  expect(screen.getByText('Due 25 Nov')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open task' })).toHaveAttribute('href', '/team/tasks/t42');
});

it('closed once, it stays closed: on re-render, on the next page, and in other tabs', async () => {
  alerts = [ADDED];
  const { rerender, unmount } = render(<NewWorkPopup />);
  fireEvent.click(await screen.findByRole('button', { name: 'Close: Vicky added you to a project' }));
  expect(screen.queryByText('Vicky added you to a project')).toBeNull();
  rerender(<NewWorkPopup />);
  expect(screen.queryByText('Vicky added you to a project')).toBeNull();
  unmount();
  render(<NewWorkPopup />);
  expect(screen.queryByText('Vicky added you to a project')).toBeNull();
  expect(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')).toEqual(['a1']);
});

it('closing it in another tab closes it here', async () => {
  alerts = [ADDED];
  render(<NewWorkPopup />);
  await screen.findByText('Vicky added you to a project');
  localStorage.setItem(SEEN_KEY, JSON.stringify(['a1']));
  act(() => { window.dispatchEvent(new StorageEvent('storage', { key: SEEN_KEY })); });
  expect(screen.queryByText('Vicky added you to a project')).toBeNull();
});

it('opening it also closes it', async () => {
  alerts = [TASK];
  render(<NewWorkPopup />);
  fireEvent.click(await screen.findByRole('link', { name: 'Open task' }));
  expect(screen.queryByText('New task from Vicky')).toBeNull();
});

it('rings once per new card, not on every poll', async () => {
  alerts = [ADDED];
  const { rerender } = render(<NewWorkPopup />);
  await screen.findByText('Vicky added you to a project');
  rerender(<NewWorkPopup />);
  rerender(<NewWorkPopup />);
  expect(playAlert).toHaveBeenCalledTimes(1);
  alerts = [TASK, ADDED];
  rerender(<NewWorkPopup />);
  await screen.findByText('New task from Vicky');
  expect(playAlert).toHaveBeenCalledTimes(2);
});

it(`shows at most ${SHOWN_MAX} cards; nothing at all when there is nothing new`, async () => {
  alerts = Array.from({ length: 5 }, (_, i) => ({ ...TASK, id: `x${i}` }));
  const { unmount } = render(<NewWorkPopup />);
  expect(await screen.findAllByText('New task from Vicky')).toHaveLength(SHOWN_MAX);
  unmount();
  alerts = [];
  render(<NewWorkPopup />);
  expect(screen.queryByRole('region', { name: 'New work' })).toBeNull();
});

it('still shows when the browser blocks storage', async () => {
  const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  alerts = [ADDED];
  render(<NewWorkPopup />);
  expect(await screen.findByText('Vicky added you to a project')).toBeInTheDocument();
  spy.mockRestore();
});

describe('order follow-ups', () => {
  const DUE: WorkAlert = {
    id: 'f1', kind: 'followup_due', by: '', title: '#AB1042 · New Order', text: 'Was due 23 Nov 2026, 11:30 am IST. Move it on, or give a reason and the next date.',
    href: '/team/orders', at: '2026-11-23T06:00:00.000Z',
  };
  const LATE: WorkAlert = {
    id: 'f2', kind: 'followup_escalated', by: '', title: '#AB1042 · New Order', text: 'Aromal S’s step is 5h late.',
    href: '/admin/orders?order=o1', at: '2026-11-23T10:00:00.000Z',
  };

  it('a step that is due reads “Order follow-up due” and opens the order list', async () => {
    alerts = [DUE];
    render(<NewWorkPopup />);
    expect(await screen.findByText('Order follow-up due')).toBeInTheDocument();
    expect(screen.getByText('#AB1042 · New Order')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open order' })).toHaveAttribute('href', '/team/orders');
    expect(playAlert).toHaveBeenCalledTimes(1);
  });

  it('an escalation to the head / admin reads “Late order follow-up”, in red, and opens that order', async () => {
    alerts = [LATE];
    render(<NewWorkPopup />);
    expect(await screen.findByText('Late order follow-up')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveClass('border-red-200');
    expect(screen.getByRole('link', { name: 'Open order' })).toHaveAttribute('href', '/admin/orders?order=o1');
  });
});
