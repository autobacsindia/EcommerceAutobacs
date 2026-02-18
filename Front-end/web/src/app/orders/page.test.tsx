import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import OrdersPage from './page';
import { useAuth } from '@/context/AuthContext';
import orderService from '@/lib/services/orderService';

// Mock dependencies
jest.mock('@/context/AuthContext');
jest.mock('@/lib/services/orderService');
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
}));
jest.mock('next/link', () => {
  return ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  );
});

// Mock icons
jest.mock('lucide-react', () => ({
  Package: () => <span>PackageIcon</span>,
  Eye: () => <span>EyeIcon</span>,
  Filter: () => <span>FilterIcon</span>,
  Search: () => <span>SearchIcon</span>,
  ChevronDown: () => <span>ChevronDownIcon</span>,
}));

// Mock Skeleton
jest.mock('@/components/skeletons/OrderHistorySkeleton', () => {
  return () => <div data-testid="order-skeleton">Loading...</div>;
});

describe('OrdersPage', () => {
  const mockUser = {
    _id: 'u1',
    name: 'John Doe',
    email: 'john@example.com',
    role: 'user',
  };

  const mockOrders = {
    orders: [
      {
        _id: 'o1',
        orderNumber: 'ORD-001',
        status: 'delivered',
        totalAmount: 150,
        createdAt: '2023-01-01T00:00:00Z',
        items: [
          {
            product: { _id: 'p1', name: 'Product 1' },
            quantity: 1,
            price: 150,
          },
        ],
      },
      {
        _id: 'o2',
        orderNumber: 'ORD-002',
        status: 'processing',
        totalAmount: 200,
        createdAt: '2023-01-02T00:00:00Z',
        items: [
          {
            product: { _id: 'p2', name: 'Product 2' },
            quantity: 2,
            price: 100,
          },
        ],
      },
    ],
    pagination: {
      currentPage: 1,
      totalPages: 1,
      totalOrders: 2,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      user: mockUser,
    });
    (orderService.getUserOrders as jest.Mock).mockResolvedValue(mockOrders);
  });

  it('renders loading skeleton initially', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      user: mockUser,
    });
    // We need to delay the promise resolution to see the loading state if we were testing async explicitly,
    // but typically useEffect triggers fetch which sets loading=true.
    // However, the component sets loading=true by default.
    render(<OrdersPage />);
    expect(screen.getByTestId('order-skeleton')).toBeInTheDocument();
    
    // Wait for the effect to complete to avoid act warnings
    await waitFor(() => {
        expect(screen.queryByTestId('order-skeleton')).not.toBeInTheDocument();
    });
  });

  it('renders orders after fetch', async () => {
    render(<OrdersPage />);

    await waitFor(() => {
      expect(screen.getAllByText(/Product 1/i)[0]).toBeInTheDocument();
    });

    expect(screen.getAllByText(/Product 2/i)[0]).toBeInTheDocument();
    expect(screen.getAllByText(/Delivered/i)[0]).toBeInTheDocument();
    expect(screen.getAllByText(/Processing/i)[0]).toBeInTheDocument();
  });

  it('filters orders by status', async () => {
    render(<OrdersPage />);

    await waitFor(() => {
      expect(screen.getAllByText(/Product 1/i)[0]).toBeInTheDocument();
    });

    // Select status filter
    // There are two selects (status and sort). Status is the first one.
    const selects = screen.getAllByRole('combobox');
    const statusSelect = selects[0];
    fireEvent.change(statusSelect, { target: { value: 'delivered' } });

    await waitFor(() => {
        expect(screen.getAllByText(/Product 1/i)[0]).toBeInTheDocument();
        expect(screen.queryByText(/Product 2/i)).not.toBeInTheDocument(); // Processing order should be hidden
    });
  });

  it('searches orders by product name', async () => {
    render(<OrdersPage />);

    await waitFor(() => {
      expect(screen.getAllByText(/Product 1/i)[0]).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/search/i); // Adjust placeholder
    fireEvent.change(searchInput, { target: { value: 'Product 1' } });

    await waitFor(() => {
        expect(screen.getAllByText(/Product 1/i)[0]).toBeInTheDocument();
        expect(screen.queryByText(/Product 2/i)).not.toBeInTheDocument();
    });
  });
});
