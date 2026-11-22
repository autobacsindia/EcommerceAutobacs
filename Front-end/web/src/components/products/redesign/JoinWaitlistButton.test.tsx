import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import JoinWaitlistButton from './JoinWaitlistButton';

const post = jest.fn();
const get = jest.fn();
jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { post: (...a: unknown[]) => post(...a), get: (...a: unknown[]) => get(...a), delete: jest.fn() },
}));
jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: true }) }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }), usePathname: () => '/products/x' }));
jest.mock('react-hot-toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

beforeEach(() => {
  post.mockReset();
  get.mockReset().mockResolvedValue({ success: true, requests: [] });
});

const open = async () => {
  render(<JoinWaitlistButton productId="p1" />);
  await waitFor(() => expect(get).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: /join the waiting list/i }));
  return screen.getByLabelText(/your mobile number/i);
};

test('the first press asks for a mobile number and sends nothing yet', async () => {
  await open();
  expect(post).not.toHaveBeenCalled();
});

test('a bad number is refused on the page, with no request sent', async () => {
  const input = await open();
  fireEvent.change(input, { target: { value: '12345' } });
  fireEvent.click(screen.getByRole('button', { name: /join the waiting list/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/valid 10-digit/i);
  expect(post).not.toHaveBeenCalled();
});

test('a good number is sent as +91… in the body (not the URL)', async () => {
  post.mockResolvedValue({ success: true, request: { _id: 'r1' } });
  const input = await open();
  fireEvent.change(input, { target: { value: '98765 43210' } });
  fireEvent.click(screen.getByRole('button', { name: /join the waiting list/i }));
  await screen.findByText(/you're on the waiting list/i);
  const [url, body] = post.mock.calls[0];
  expect(url).not.toContain('9876543210');
  expect(body).toEqual({ variantId: undefined, phone: '+919876543210' });
});
