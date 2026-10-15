/**
 * Adding people with a company login, and resetting one. The server enforces
 * who may do what; these pin what the admin/head sees and sends.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import TeamMembersPanel, { generateTempPassword } from './TeamMembersPanel';

const get = jest.fn();
const post = jest.fn();
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), delete: jest.fn() },
}));
jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { _id: 'admin', role: 'admin' } }) }));

const team = (members: unknown[] = []) => ({
  success: true, team: 'sales', teamLabel: 'Sales', canManage: true, members, invites: [],
});
const sam = {
  id: 'u1', name: 'Sam Kumar', email: '', phone: '9876543210', isHead: false, addedAt: '2026-10-15T00:00:00Z',
  username: 'sam.sales', companyAccount: true,
};
const ravi = {
  id: 'u2', name: 'Ravi', email: 'ravi@gmail.com', phone: '9876543211', isHead: false, addedAt: '2026-10-15T00:00:00Z',
  username: null, companyAccount: false,
};

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  jest.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('company logins', () => {
  it('creates one by default and shows the sign-in details once', async () => {
    get.mockResolvedValue(team());
    post.mockResolvedValue({ success: true, member: sam });
    render(<TeamMembersPanel team="sales" allowHeadInvite />);

    fireEvent.change(await screen.findByLabelText('Full name'), { target: { value: 'Sam Kumar' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'Sam Sales' } });
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '9876543210' } });
    fireEvent.change(screen.getByLabelText('First password'), { target: { value: 'Temporary#2026' } });
    fireEvent.click(screen.getByRole('button', { name: /Create login/ }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/accounts', expect.objectContaining({
      name: 'Sam Kumar', username: 'samsales', phone: '9876543210', password: 'Temporary#2026', team: 'sales', isHead: false,
    })));
    const box = await screen.findByRole('status');
    expect(box).toHaveTextContent('Account created for Sam Kumar');
    expect(box).toHaveTextContent('samsales');
    expect(box).toHaveTextContent('Temporary#2026');
    fireEvent.click(within(box).getByText(/hide these details/));
    expect(screen.queryByText('Temporary#2026')).toBeNull();
  });

  it('lists a company account by username; only it gets "Change password"', async () => {
    get.mockResolvedValue(team([sam, ravi]));
    render(<TeamMembersPanel team="sales" allowHeadInvite />);
    const samRow = (await screen.findByText('Sam Kumar')).closest('tr')!;
    const raviRow = screen.getByText('Ravi').closest('tr')!;
    expect(within(samRow).getByText('sam.sales')).toBeInTheDocument();
    expect(within(samRow).getByText('Company')).toBeInTheDocument();
    expect(within(raviRow).getByText('ravi@gmail.com')).toBeInTheDocument();
    expect(within(raviRow).queryByRole('button', { name: /Change password/ })).toBeNull();
    expect(within(samRow).getByRole('button', { name: /Change password/ })).toBeInTheDocument();
  });

  it('the admin types the new password (or generates one) and it is shown once', async () => {
    get.mockResolvedValue(team([sam]));
    post.mockResolvedValue({ success: true, member: sam });
    render(<TeamMembersPanel team="sales" allowHeadInvite />);
    const samRow = (await screen.findByText('Sam Kumar')).closest('tr')!;
    fireEvent.click(within(samRow).getByRole('button', { name: /Change password/ }));

    const form = screen.getByRole('form', { name: /Change password for Sam Kumar/ });
    fireEvent.change(within(form).getByLabelText('New password'), { target: { value: 'AdminChose#2026' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save password' }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/members/u1/password', { password: 'AdminChose#2026' }));
    expect(await screen.findByRole('status')).toHaveTextContent('AdminChose#2026');
    expect(screen.queryByRole('form', { name: /Change password for/ })).toBeNull();
  });

  it('Generate fills a strong password into the change form', async () => {
    get.mockResolvedValue(team([sam]));
    render(<TeamMembersPanel team="sales" allowHeadInvite />);
    fireEvent.click(within((await screen.findByText('Sam Kumar')).closest('tr')!).getByRole('button', { name: /Change password/ }));
    const form = screen.getByRole('form', { name: /Change password for Sam Kumar/ });
    fireEvent.click(within(form).getByRole('button', { name: 'Generate' }));
    expect((within(form).getByLabelText('New password') as HTMLInputElement).value.length).toBeGreaterThanOrEqual(12);
  });

  it('still offers an email invite', async () => {
    get.mockResolvedValue(team());
    render(<TeamMembersPanel team="sales" allowHeadInvite />);
    fireEvent.click(await screen.findByRole('tab', { name: /Invite by email/ }));
    expect(screen.getByPlaceholderText('Email (their own)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send invite/ })).toBeInTheDocument();
  });
});

describe('generateTempPassword', () => {
  it('is long, unambiguous and different every time', () => {
    const a = generateTempPassword();
    const b = generateTempPassword();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(12);
    expect(a.slice(0, -2)).not.toMatch(/[0O1lI]/);
  });
});
