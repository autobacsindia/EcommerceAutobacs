import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FestivalOfferSettingPanel from './FestivalOfferSettingPanel';
import apiClient from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

jest.mock('@/lib/api', () => ({ __esModule: true, default: { patch: jest.fn() } }));
jest.mock('@/context/AuthContext', () => ({ useAuth: jest.fn() }));

const patch = apiClient.patch as jest.Mock;
const asUser = (user: unknown) => (useAuth as jest.Mock).mockReturnValue({ user });
const admin = { role: 'admin' };

beforeEach(() => {
  patch.mockReset().mockResolvedValue({ success: true, updated: 1, unchanged: 0, requested: 1, notFound: [] });
});

describe('FestivalOfferSettingPanel', () => {
  it('shows a read-only line to staff outside marketing and offers no controls', () => {
    asUser({ role: 'staff', staff: { team: 'sales', isHead: true } });
    render(<FestivalOfferSettingPanel productId="p1" setting={{ mode: 'custom', percent: 7 }} />);
    expect(screen.getByText(/Custom 7%/)).toBeInTheDocument();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('lets a marketing team member save', async () => {
    asUser({ role: 'staff', staff: { team: 'marketing', isHead: false } });
    render(<FestivalOfferSettingPanel productId="p1" setting={null} />);
    fireEvent.click(screen.getByRole('radio', { name: /No Diwali offer/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply Diwali offer' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith(expect.any(String), { productIds: ['p1'], mode: 'none' }));
    expect(await screen.findByText('Saved: No offer')).toBeInTheDocument();
  });

  it.each(['0', '31', '7.5', 'abc', ''])('blocks a custom value of "%s" before calling the server', (v) => {
    asUser(admin);
    render(<FestivalOfferSettingPanel productId="p1" setting={null} />);
    fireEvent.click(screen.getByRole('radio', { name: /Custom %/ }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: v } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply Diwali offer' }));
    expect(screen.getByRole('status')).toHaveTextContent('whole number from 1 to 30');
    expect(patch).not.toHaveBeenCalled();
  });

  it('sends a valid custom % as a number and shows a server refusal', async () => {
    asUser(admin);
    patch.mockRejectedValue(new Error('Not authorized'));
    render(<FestivalOfferSettingPanel productId="p1" setting={null} />);
    fireEvent.click(screen.getByRole('radio', { name: /Custom %/ }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply Diwali offer' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith(expect.any(String), { productIds: ['p1'], mode: 'custom', percent: 7 }));
    expect(await screen.findByText('Not authorized')).toBeInTheDocument();
  });
});
