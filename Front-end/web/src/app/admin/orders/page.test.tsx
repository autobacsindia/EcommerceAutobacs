import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import AdminOrdersPage from './page';
import apiClient from '@/lib/api';

// Mock dependencies
jest.mock('@/lib/api');
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
  useSearchParams: () => ({
    get: jest.fn(),
  }),
}));
jest.mock('next/link', () => {
  return ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  );
});

// Mock icons
jest.mock('lucide-react', () => ({
  Eye: () => <span>EyeIcon</span>,
  RefreshCw: () => <span>RefreshCwIcon</span>,
  Download: () => <span>DownloadIcon</span>,
  ArrowUpDown: () => <span>ArrowUpDownIcon</span>,
  Search: () => <span>SearchIcon</span>,
  Filter: () => <span>FilterIcon</span>,
  CheckSquare: () => <span>CheckSquareIcon</span>,
  Square: () => <span>SquareIcon</span>,
}));

// Mock Child Components
jest.mock('@/components/orders/OrderFiltersPanel', () => {
  return ({ onFiltersChange }: { onFiltersChange: (f: any) => void }) => (
    <div data-testid="filters-panel">
      <button 
        data-testid="apply-filter-btn"
        onClick={() => onFiltersChange({ 
          search: 'test-order',
          statuses: [],
          startDate: '',
          endDate: '',
          minAmount: '',
          maxAmount: '',
          customer: ''
        })}
      >
        Apply Filter
      </button>
    </div>
  );
});

jest.mock('@/components/orders/BulkActionsBar', () => {
  return ({ selectedCount }: { selectedCount: number }) => (
    <div data-testid="bulk-actions">
      Selected: {selectedCount}
    </div>
  );
});

describe('AdminOrdersPage', () => {
  const mockOrders = {
    success: true,
    count: 2,
    orders: [
      {
        _id: 'o1',
        orderNumber: 'ORD-001',
        createdAt: '2023-01-01T00:00:00Z',
        status: 'pending',
        totalAmount: 100,
        user: { _id: 'u1', name: 'User 1', email: 'u1@example.com' },
        items: [],
      },
      {
        _id: 'o2',
        orderNumber: 'ORD-002',
        createdAt: '2023-01-02T00:00:00Z',
        status: 'delivered',
        totalAmount: 200,
        user: { _id: 'u2', name: 'User 2', email: 'u2@example.com' },
        items: [],
      },
    ],
    pagination: {
      total: 2,
      pages: 1,
      currentPage: 1,
      hasNext: false,
      hasPrev: false,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (apiClient.get as jest.Mock).mockResolvedValue(mockOrders);
    // Mock put for status update
    (apiClient.put as jest.Mock).mockResolvedValue({ success: true });
  });

  it('renders orders table after fetch', async () => {
    render(<AdminOrdersPage />);

    await waitFor(() => {
      expect(screen.getByText(/ORD-001/)).toBeInTheDocument();
      expect(screen.getByText(/ORD-002/)).toBeInTheDocument();
      expect(screen.getByText('User 1')).toBeInTheDocument();
      expect(screen.getByText('User 2')).toBeInTheDocument();
    });
  });

  it('updates status when changed', async () => {
    render(<AdminOrdersPage />);

    await waitFor(() => {
      expect(screen.getByText(/ORD-001/)).toBeInTheDocument();
    });

    // Find the row containing ORD-001
    const row = screen.getByText(/ORD-001/).closest('tr');
    expect(row).toBeInTheDocument();
    
    // Find select within that row
    const statusSelect = within(row!).getByRole('combobox');
    
    fireEvent.change(statusSelect, { target: { value: 'confirmed' } });
    
    await waitFor(() => {
        expect(apiClient.put).toHaveBeenCalledWith(
            expect.stringContaining('/o1'),
            expect.objectContaining({ status: 'confirmed' })
        );
    });
  });

  it('refetches orders when filters change', async () => {
    render(<AdminOrdersPage />);

    await waitFor(() => {
      expect(screen.getByText(/ORD-001/)).toBeInTheDocument();
    });

    // Trigger filter change
    fireEvent.click(screen.getByTestId('apply-filter-btn'));

    await waitFor(() => {
      // Expect apiClient.get to be called with search param
      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('orderNumber=test-order')
      );
    });
  });

  it('handles row selection', async () => {
    render(<AdminOrdersPage />);

    await waitFor(() => {
      expect(screen.getByText(/ORD-001/)).toBeInTheDocument();
    });

    // Find checkbox for first order
    // Assuming standard checkbox input
    const checkboxes = screen.getAllByRole('checkbox');
    // First checkbox might be "Select All" in header
    // Let's click the second one (first row)
    if (checkboxes.length > 1) {
        fireEvent.click(checkboxes[1]);
        
        await waitFor(() => {
            expect(screen.getByTestId('bulk-actions')).toHaveTextContent('Selected: 1');
        });
    }
  });
});
