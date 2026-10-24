/**
 * A custom group's members: the group's creator / an admin adds people after
 * the group was made and removes them; an ordinary member only sees the list.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MembersPanel from './MembersPanel';

const get = jest.fn();
const post = jest.fn();
const del = jest.fn();
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), delete: (...a: unknown[]) => del(...a) },
}));
jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { role: 'staff', staff: { team: 'procurement' } } }) }));

const wrap = (ui: React.ReactElement) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);
const P = (id: string, name: string) => ({ id, name, role: 'staff' as const, team: 'procurement', teamLabel: 'Procurement', isHead: false });

beforeEach(() => { get.mockReset(); post.mockReset(); del.mockReset(); window.confirm = jest.fn(() => true); });

it('the group creator adds people who are not in it yet, and removes a member', async () => {
  get.mockImplementation((url: string) => Promise.resolve(url === '/chat/people'
    ? { people: [P('u1', 'Hari'), P('u2', 'Mona'), P('u3', 'Lata')] }
    : { members: [P('u1', 'Hari'), P('u2', 'Mona')], canManage: true, createdBy: 'u1' }));
  post.mockResolvedValue({ members: [P('u1', 'Hari'), P('u2', 'Mona'), P('u3', 'Lata')] });
  del.mockResolvedValue({ members: [P('u1', 'Hari')] });
  wrap(<MembersPanel channelId="c1" />);

  expect(await screen.findByText('2 members')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Remove Hari' })).not.toBeInTheDocument(); // the creator stays
  fireEvent.click(await screen.findByRole('checkbox', { name: /Lata/ }));
  fireEvent.click(screen.getByRole('button', { name: /Add 1 to group/ }));
  await waitFor(() => expect(post).toHaveBeenCalledWith('/chat/channels/c1/members', { userIds: ['u3'] }));
  expect(await screen.findByText('3 members')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Remove Mona' }));
  await waitFor(() => expect(del).toHaveBeenCalledWith('/chat/channels/c1/members/u2'));
});

it('an ordinary member sees the list but cannot add or remove', async () => {
  get.mockResolvedValue({ members: [P('u1', 'Hari'), P('u2', 'Mona')], canManage: false, createdBy: 'u1' });
  wrap(<MembersPanel channelId="c1" />);
  expect(await screen.findByText('Mona')).toBeInTheDocument();
  expect(screen.queryByText('Add people')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
  expect(get).not.toHaveBeenCalledWith('/chat/people');
});
