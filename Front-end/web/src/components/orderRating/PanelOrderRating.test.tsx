import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import PanelOrderRating from './PanelOrderRating';

jest.mock('@/lib/api');
const mockUser = { current: { role: 'staff', staff: { isHead: false } } as Record<string, unknown> };
jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: mockUser.current }) }));

const renderCard = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <PanelOrderRating orderId="o1" />
  </QueryClientProvider>,
);

beforeEach(() => jest.resetAllMocks());

it('lets the salesperson make a WhatsApp link on an unrated offline order', async () => {
  mockUser.current = { role: 'staff', staff: { isHead: false } };
  (apiClient.get as jest.Mock).mockResolvedValue({ rating: null, rated: false, canShareLink: true });
  (apiClient.post as jest.Mock).mockResolvedValue({
    url: 'https://x.test/rate/t', message: 'Hi Asha, please rate us: https://x.test/rate/t',
    whatsappUrl: 'https://wa.me/919876500000?text=hi', expiresAt: '2026-12-01',
  });
  renderCard();
  fireEvent.click(await screen.findByRole('button', { name: /get rating link/i }));
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/order-ratings/panel/order/o1/share-link', {}));
  expect(await screen.findByRole('link', { name: /send on whatsapp/i })).toHaveAttribute('href', 'https://wa.me/919876500000?text=hi');
  expect(screen.getByText(/please rate us/)).toBeInTheDocument();
});

it('hides itself for a salesperson with nothing to do (website or undelivered order)', async () => {
  mockUser.current = { role: 'staff', staff: { isHead: false } };
  (apiClient.get as jest.Mock).mockResolvedValue({ rating: null, rated: false, canShareLink: false });
  const { container } = renderCard();
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
  await waitFor(() => expect(container).toBeEmptyDOMElement());
});

it('shows admins the rating, who sent the link, and the same-network warning', async () => {
  mockUser.current = { role: 'admin' };
  (apiClient.get as jest.Mock).mockResolvedValue({
    rated: true, canShareLink: false,
    rating: {
      stars: 5, comment: 'Great', source: 'salesperson-link', createdAt: '2026-11-10T10:00:00Z', updatedAt: '2026-11-10T10:00:00Z',
      editCount: 0, salesperson: { id: 's', name: 'Ravi' }, sentBy: { id: 's', name: 'Ravi' }, sameNetworkAsSender: true,
    },
  });
  renderCard();
  expect(await screen.findByText(/from the WhatsApp link sent by Ravi/)).toBeInTheDocument();
  expect(screen.getByText(/same internet connection/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /get rating link/i })).not.toBeInTheDocument();
});

it('hides itself on 403', async () => {
  mockUser.current = { role: 'staff', staff: { isHead: false } };
  (apiClient.get as jest.Mock).mockRejectedValue(new Error('forbidden'));
  const { container } = renderCard();
  await waitFor(() => expect(container).toBeEmptyDOMElement());
});
