import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import AdminVehiclesPage from './page';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';

// Mock dependencies
jest.mock('@/lib/api');

// Mock icons
jest.mock('lucide-react', () => ({
  Plus: () => <span data-testid="icon-plus">Plus</span>,
  Edit: () => <span data-testid="icon-edit">Edit</span>,
  Trash2: () => <span data-testid="icon-trash">Trash</span>,
  Search: () => <span data-testid="icon-search">Search</span>,
  Package: () => <span data-testid="icon-package">Package</span>,
  ToggleLeft: () => <span data-testid="icon-toggle-left">ToggleLeft</span>,
  ToggleRight: () => <span data-testid="icon-toggle-right">ToggleRight</span>,
}));

describe('AdminVehiclesPage', () => {
  const mockVehicles = [
    {
      _id: 'v1',
      make: 'Toyota',
      model: 'Corolla',
      slug: 'toyota-corolla',
      isActive: true,
      productCount: 15
    },
    {
      _id: 'v2',
      make: 'Honda',
      model: 'Civic',
      slug: 'honda-civic',
      isActive: false,
      productCount: 8
    }
  ];

  const mockResponse = {
    vehicles: mockVehicles,
    pagination: {
      total: 2,
      page: 1,
      pages: 1,
      limit: 20,
      hasNext: false,
      hasPrev: false
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (apiClient.get as jest.Mock).mockResolvedValue(mockResponse);
    (apiClient.delete as jest.Mock).mockResolvedValue({ success: true });
    (apiClient.patch as jest.Mock).mockResolvedValue({ success: true });
    
    window.confirm = jest.fn().mockReturnValue(true);
    window.alert = jest.fn();
  });

  it('renders loading state initially', async () => {
    (apiClient.get as jest.Mock).mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(mockResponse), 100)));
    
    render(<AdminVehiclesPage />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    
    await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
  });

  it('renders vehicles list after fetch', async () => {
    render(<AdminVehiclesPage />);

    await waitFor(() => {
      expect(screen.getByText('Toyota')).toBeInTheDocument();
      expect(screen.getByText('Corolla')).toBeInTheDocument();

      expect(screen.getByText('Honda')).toBeInTheDocument();
      expect(screen.getByText('Civic')).toBeInTheDocument();
    });
  });

  it('handles search with debounce', async () => {
    jest.useFakeTimers();
    render(<AdminVehiclesPage />);

    await waitFor(() => {
      expect(screen.getByText('Toyota')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('Search vehicles by make or model...');
    fireEvent.change(searchInput, { target: { value: 'toyota' } });

    act(() => {
      jest.advanceTimersByTime(500);
    });

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('search=toyota')
      );
    });

    jest.useRealTimers();
  });

  it('handles delete vehicle', async () => {
    render(<AdminVehiclesPage />);

    await waitFor(() => {
      expect(screen.getByText('Toyota')).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByTitle('Delete permanently');
    fireEvent.click(deleteButtons[0]);

    expect(window.confirm).toHaveBeenCalled();

    await waitFor(() => {
      expect(apiClient.delete).toHaveBeenCalled();
      expect(apiClient.get).toHaveBeenCalledTimes(2); // Refetch
    });
  });

  // The route is a REAL delete now; it used to just set isActive:false, which
  // made the trash button a duplicate of the deactivate toggle and left admins
  // with no way to remove a vehicle at all.
  describe('permanent delete confirmation', () => {
    const conflict = (productCount: number) =>
      Object.assign(new Error('mapped to products'), {
        status: 409,
        rawData: { requiresConfirmation: true, productCount },
      });

    it('does not call the API when the first confirm is declined', async () => {
      window.confirm = jest.fn().mockReturnValue(false);

      render(<AdminVehiclesPage />);
      await waitFor(() => expect(screen.getByText('Toyota')).toBeInTheDocument());

      fireEvent.click(screen.getAllByTitle('Delete permanently')[0]);

      expect(apiClient.delete).not.toHaveBeenCalled();
    });

    it('re-confirms with the server-reported product count, then forces', async () => {
      (apiClient.delete as jest.Mock)
        .mockRejectedValueOnce(conflict(12))
        .mockResolvedValueOnce({ success: true, productsUnmapped: 12 });

      render(<AdminVehiclesPage />);
      await waitFor(() => expect(screen.getByText('Toyota')).toBeInTheDocument());

      fireEvent.click(screen.getAllByTitle('Delete permanently')[0]);

      await waitFor(() => {
        expect(apiClient.delete).toHaveBeenCalledTimes(2);
      });

      // The count shown must be the server's (12), not the row's own
      // productCount (15) — the row counts only ACTIVE products while the
      // delete writes to every product, and confirming one number while
      // writing another is how an admin gets surprised.
      const prompts = (window.confirm as jest.Mock).mock.calls.map((c) => String(c[0]));
      expect(prompts.some((p) => p.includes('12 product'))).toBe(true);
      expect(prompts.some((p) => p.includes('15 product'))).toBe(false);

      expect(apiClient.delete).toHaveBeenLastCalledWith(
        `${API_ENDPOINTS.VEHICLE_DELETE('v1')}?force=true`,
      );
    });

    it('aborts without forcing when the product-count confirm is declined', async () => {
      (apiClient.delete as jest.Mock).mockRejectedValueOnce(conflict(12));
      window.confirm = jest
        .fn()
        .mockReturnValueOnce(true)   // yes, delete permanently
        .mockReturnValueOnce(false); // no, not once I see 12 products

      render(<AdminVehiclesPage />);
      await waitFor(() => expect(screen.getByText('Toyota')).toBeInTheDocument());

      fireEvent.click(screen.getAllByTitle('Delete permanently')[0]);

      await waitFor(() => expect(window.confirm).toHaveBeenCalledTimes(2));
      // Exactly one call: the probing one. No force call may follow a decline.
      expect(apiClient.delete).toHaveBeenCalledTimes(1);
    });

    it('never retries with force on a non-409 failure', async () => {
      (apiClient.delete as jest.Mock).mockRejectedValue(
        Object.assign(new Error('Vehicle not found'), { status: 404, rawData: {} }),
      );

      render(<AdminVehiclesPage />);
      await waitFor(() => expect(screen.getByText('Toyota')).toBeInTheDocument());

      fireEvent.click(screen.getAllByTitle('Delete permanently')[0]);

      await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Vehicle not found'));
      expect(apiClient.delete).toHaveBeenCalledTimes(1);
    });
  });

  it('handles toggle status', async () => {
    render(<AdminVehiclesPage />);

    await waitFor(() => {
      expect(screen.getByText('Toyota')).toBeInTheDocument();
    });

    const toggleButton = screen.getByTitle('Deactivate'); // Toyota is active
    fireEvent.click(toggleButton);

    await waitFor(() => {
      expect(apiClient.patch).toHaveBeenCalled();
      expect(apiClient.get).toHaveBeenCalledTimes(2); // Refetch
    });
  });

  it('handles empty state', async () => {
    (apiClient.get as jest.Mock).mockResolvedValue({
      vehicles: [],
      pagination: { total: 0, page: 1, pages: 1 }
    });

    render(<AdminVehiclesPage />);

    await waitFor(() => {
      expect(screen.getByText('No vehicles found.')).toBeInTheDocument();
    });
  });
});
