import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminReturnsPage from './page';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';

jest.mock('@/lib/api');

// Generic lucide-react mock — every icon renders a stub span, so the test never
// needs updating when the page's icon set changes.
jest.mock('lucide-react', () => new Proxy({}, {
  get: (_t, name) => () => <span data-testid={`icon-${String(name)}`} />,
}));

jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

const listResponse = {
  requests: [
    {
      _id: 'ret000001',
      order: { _id: 'ord1', orderNumber: 'AB-1001' },
      user: { name: 'Asha Rao', email: 'asha@example.com' },
      type: 'return',
      status: 'pending',
      items: [{ product: { name: 'Wiper Blade', images: [] }, quantity: 2, reason: 'manufacturing_defect', unitPrice: 500 }],
      refund: { productValue: 1000 },
      timeline: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
  pagination: { currentPage: 1, totalPages: 1 },
  count: 1,
};

describe('AdminReturnsPage (new flow)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApi.get.mockImplementation((endpoint: string) => {
      if (endpoint.startsWith(API_ENDPOINTS.ADMIN_RETURNS)) return Promise.resolve(listResponse as never);
      return Promise.resolve({ request: { ...listResponse.requests[0], problemDescription: 'rattles' } } as never);
    });
  });

  it('renders the returns list with order number, customer and status', async () => {
    render(<AdminReturnsPage />);
    expect(await screen.findByText('#AB-1001')).toBeInTheDocument();
    expect(screen.getByText('Asha Rao')).toBeInTheDocument();
    // 'PENDING' also appears as a filter <option>; assert the status badge exists too.
    expect(screen.getAllByText('PENDING').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('₹1,000.00')).toBeInTheDocument();
  });

  it('opens the detail modal and loads the request detail endpoint', async () => {
    render(<AdminReturnsPage />);
    await screen.findByText('#AB-1001');
    fireEvent.click(screen.getByTitle('View'));
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith(API_ENDPOINTS.ADMIN_RETURN_DETAIL('ret000001')));
    expect(await screen.findByText('rattles')).toBeInTheDocument();
  });
});
