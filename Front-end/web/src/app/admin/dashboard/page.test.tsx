import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import AdminDashboardPage from './page';
import { useAuth } from '@/context/AuthContext';
import { useSSE } from '@/hooks/useSSE';
import { useCurrency } from '@/context/CurrencyContext';

// Mock dependencies
jest.mock('@/context/AuthContext');
jest.mock('@/context/CurrencyContext');
jest.mock('@/hooks/useSSE');
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
}));

// Mock icons
jest.mock('lucide-react', () => ({
  Activity: () => <span>ActivityIcon</span>,
  DollarSign: () => <span>DollarSignIcon</span>,
  ShoppingCart: () => <span>ShoppingCartIcon</span>,
  Users: () => <span>UsersIcon</span>,
  AlertTriangle: () => <span>AlertTriangleIcon</span>,
  Package: () => <span>PackageIcon</span>,
  Clock: () => <span>ClockIcon</span>,
  CheckCircle: () => <span>CheckCircleIcon</span>,
  XCircle: () => <span>XCircleIcon</span>,
  Server: () => <span>ServerIcon</span>,
  Database: () => <span>DatabaseIcon</span>,
  Layout: () => <span>LayoutIcon</span>,
  TrendingUp: () => <span>TrendingUpIcon</span>,
  MessageSquare: () => <span>MessageSquareIcon</span>,
}));

describe('AdminDashboardPage', () => {
  const mockUser = {
    _id: 'u1',
    name: 'Admin User',
    role: 'admin',
  };

  let messageHandler: (msg: any) => void;

  beforeEach(() => {
    jest.clearAllMocks();
    
    (useAuth as jest.Mock).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
      isLoading: false,
    });

    (useCurrency as jest.Mock).mockReturnValue({
      formatPrice: (price: number) => `$${price}`,
    });

    // Capture the onMessage handler passed to useSSE
    (useSSE as jest.Mock).mockImplementation(({ onMessage }) => {
      messageHandler = onMessage;
      return { connectionState: 'connected' };
    });
  });

  it('renders dashboard skeleton or initial state', () => {
    render(<AdminDashboardPage />);
    // Check for some static text or loading state
    // The component renders the main layout immediately but data is null
    expect(screen.getByText('Admin Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Loading dashboard data...')).toBeInTheDocument();
  });

  it('updates health metrics on SSE message', async () => {
    render(<AdminDashboardPage />);

    const healthData = {
      type: 'health',
      data: {
        overall: { status: 'healthy', score: 98 },
        dimensions: {
          infrastructure: { status: 'healthy', score: 100 },
          database: { status: 'healthy', score: 99 },
          application: { status: 'healthy', score: 95 },
          business: { status: 'healthy', score: 98 },
        },
      },
    };

    act(() => {
      if (messageHandler) messageHandler(healthData);
    });

    await waitFor(() => {
      expect(screen.getAllByText('98').length).toBeGreaterThan(0);
      // "Healthy" might appear multiple times (overall + dimensions)
      expect(screen.getAllByText(/Healthy/i).length).toBeGreaterThan(0);
    });
  });

  it('updates analytics on SSE message', async () => {
    render(<AdminDashboardPage />);

    const analyticsData = {
      type: 'analytics',
      data: {
        sales: {
          revenueToday: 1500,
          revenueWeek: 10000,
          revenueMonth: 50000,
          ordersToday: 10,
        },
        orders: {
            statusBreakdown: {
                pending: 2,
                processing: 3,
                delivered: 5
            },
            recentOrders: [
                { id: 'o1', orderNumber: 'ORD-1', customerName: 'John', amount: 100, status: 'delivered', createdAt: new Date().toISOString() }
            ]
        },
        customers: { newToday: 5, activeLast24h: 20, total: 100 },
        system: {
            inventory: { lowStock: 2, outOfStock: 0 },
            apiRequests: 1000,
            errorRate: 0.1
        },
        messages: {
            total: 5,
            breakdown: { new: 1, read: 2, replied: 1, closed: 1 },
            recentMessages: []
        }
      },
    };

    act(() => {
      if (messageHandler) messageHandler(analyticsData);
    });

    await waitFor(() => {
      expect(screen.getByText('$1500')).toBeInTheDocument();
      expect(screen.getAllByText('10').length).toBeGreaterThan(0); // Orders today
      expect(screen.getByText('ORD-1')).toBeInTheDocument();
    });
  });
});
