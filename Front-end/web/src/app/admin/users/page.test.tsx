import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminUsersPage from './page';
import apiClient from '@/lib/api';

// Mock dependencies
jest.mock('@/lib/api');

// Mock icons
jest.mock('lucide-react', () => ({
  Plus: () => <span data-testid="icon-plus">Plus</span>,
  Trash2: () => <span data-testid="icon-trash">Trash</span>,
  Search: () => <span data-testid="icon-search">Search</span>,
  Eye: () => <span data-testid="icon-eye">Eye</span>,
  X: () => <span data-testid="icon-x">IconClose</span>,
}));

describe('AdminUsersPage', () => {
  const mockUsers = [
    {
      _id: 'u1',
      name: 'John Doe',
      email: 'john@example.com',
      role: 'admin',
      isActive: true,
      createdAt: '2023-01-01T00:00:00Z',
      addresses: [{ phone: '1234567890', isDefault: true }]
    },
    {
      _id: 'u2',
      name: 'Jane Smith',
      email: 'jane@example.com',
      role: 'customer',
      isActive: false,
      createdAt: '2023-02-01T00:00:00Z',
      addresses: []
    }
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (apiClient.get as jest.Mock).mockResolvedValue({ users: mockUsers });
    (apiClient.delete as jest.Mock).mockResolvedValue({ success: true });
    window.confirm = jest.fn().mockReturnValue(true);
    window.alert = jest.fn();
  });

  it('renders loading state initially', async () => {
    (apiClient.get as jest.Mock).mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ users: mockUsers }), 100)));
    render(<AdminUsersPage />);
    expect(screen.getByText('Users Management')).toBeInTheDocument();
    // Check for skeleton or specific loading indicator if possible, or just wait
    await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
  });

  it('renders users list after fetch', async () => {
    render(<AdminUsersPage />);

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
      expect(screen.getByText('john@example.com')).toBeInTheDocument();
      expect(screen.getByText('admin')).toBeInTheDocument();
      expect(screen.getByText('customer')).toBeInTheDocument();
    });
  });

  it('handles search and filtering', async () => {
    render(<AdminUsersPage />);

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    // Search
    const searchInput = screen.getByPlaceholderText('Search users...');
    fireEvent.change(searchInput, { target: { value: 'Jane' } });

    expect(screen.queryByText('John Doe')).not.toBeInTheDocument();
    expect(screen.getByText('Jane Smith')).toBeInTheDocument();

    // Reset search
    fireEvent.change(searchInput, { target: { value: '' } });
    expect(screen.getByText('John Doe')).toBeInTheDocument();

    // Filter by role
    const roleSelect = screen.getByRole('combobox');
    fireEvent.change(roleSelect, { target: { value: 'admin' } });

    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.queryByText('Jane Smith')).not.toBeInTheDocument();
  });

  it('handles delete user', async () => {
    render(<AdminUsersPage />);

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByTitle('Delete User');
    fireEvent.click(deleteButtons[0]); // Delete John

    expect(window.confirm).toHaveBeenCalled();
    
    await waitFor(() => {
      expect(apiClient.delete).toHaveBeenCalledWith('/users/u1');
      // John should be removed from list
      expect(screen.queryByText('John Doe')).not.toBeInTheDocument();
    });
  });

  it('opens and closes user details modal', async () => {
    render(<AdminUsersPage />);

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    const viewButtons = screen.getAllByTitle('View Details');
    fireEvent.click(viewButtons[0]); // View John

    // Check modal content
    expect(screen.getByText('User Details')).toBeInTheDocument();
    expect(screen.getByText('1234567890')).toBeInTheDocument(); // Phone
    expect(screen.getByText('Default')).toBeInTheDocument();

    // Close modal
    const closeButton = screen.getByText('Close');
    fireEvent.click(closeButton);

    expect(screen.queryByText('User Details')).not.toBeInTheDocument();
  });
});
