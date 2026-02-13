import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminMessagesPage from './page';
import apiClient from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';

// Mock dependencies
jest.mock('@/lib/api');
jest.mock('@/context/AuthContext');
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

// Mock icons
jest.mock('lucide-react', () => ({
  CheckCircle: () => <span data-testid="icon-check">Check</span>,
  XCircle: () => <span data-testid="icon-x-circle">Cancel</span>,
  Trash2: () => <span data-testid="icon-trash">Trash</span>,
  Eye: () => <span data-testid="icon-eye">Eye</span>,
  Filter: () => <span data-testid="icon-filter">Filter</span>,
  Search: () => <span data-testid="icon-search">Search</span>,
  Mail: () => <span data-testid="icon-mail">Mail</span>,
  MessageSquare: () => <span data-testid="icon-message">Message</span>,
  Clock: () => <span data-testid="icon-clock">Clock</span>,
}));

describe('AdminMessagesPage', () => {
  const mockRouter = { push: jest.fn() };
  const mockMessages = [
    {
      _id: 'm1',
      name: 'User 1',
      email: 'user1@example.com',
      subject: 'Subject 1',
      message: 'Message 1',
      status: 'new',
      createdAt: '2023-01-01T00:00:00Z',
    },
    {
      _id: 'm2',
      name: 'User 2',
      email: 'user2@example.com',
      subject: 'Subject 2',
      message: 'Message 2',
      status: 'read',
      createdAt: '2023-01-02T00:00:00Z',
    },
  ];

  const mockResponse = {
    success: true,
    data: mockMessages,
    page: 1,
    pages: 1,
    total: 2,
    count: 2
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
    (useAuth as jest.Mock).mockReturnValue({ isAuthenticated: true, isLoading: false });
    (apiClient.get as jest.Mock).mockResolvedValue(mockResponse);
    (apiClient.put as jest.Mock).mockResolvedValue({ success: true });
    (apiClient.delete as jest.Mock).mockResolvedValue({ success: true });
    (apiClient.post as jest.Mock).mockResolvedValue({ success: true });
    
    window.confirm = jest.fn().mockReturnValue(true);
    window.alert = jest.fn();
  });

  it('redirects to login if not authenticated', () => {
    (useAuth as jest.Mock).mockReturnValue({ isAuthenticated: false, isLoading: false });
    render(<AdminMessagesPage />);
    expect(mockRouter.push).toHaveBeenCalledWith('/login');
  });

  it('renders messages list after fetch', async () => {
    render(<AdminMessagesPage />);

    // Use findByText which waits automatically
    const user1 = await screen.findAllByText('User 1');
    expect(user1[0]).toBeInTheDocument();
    
    expect(screen.getByText('Subject 1')).toBeInTheDocument();
    
    // Status badges and filter options share text
    const newStatus = screen.getAllByText('New');
    expect(newStatus.length).toBeGreaterThan(0);
    
    const user2 = await screen.findAllByText('User 2');
    expect(user2.length).toBeGreaterThan(0);
    
    const readStatus = screen.getAllByText('Read');
    expect(readStatus.length).toBeGreaterThan(0);
  });

  it('handles filtering by status', async () => {
    render(<AdminMessagesPage />);

    await waitFor(() => {
      expect(screen.getAllByText('User 1')[0]).toBeInTheDocument();
    });

    const filterSelect = screen.getByRole('combobox');
    fireEvent.change(filterSelect, { target: { value: 'read' } });

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('status=read')
      );
    });
  });

  it('opens message details and marks as read', async () => {
    render(<AdminMessagesPage />);

    await waitFor(() => {
      expect(screen.getAllByText('User 1')[0]).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByText('User 1')[0]);

    await waitFor(() => {
      // Check if details are visible (e.g. "Inquiry" header)
      expect(screen.getByText('Inquiry')).toBeInTheDocument();
    });

    await waitFor(() => {
      // It should mark 'new' message as 'read'
      expect(apiClient.put).toHaveBeenCalledWith(
        expect.stringContaining('/contact/m1'),
        expect.objectContaining({ status: 'read' })
      );
    });
  });

  it('handles reply submission', async () => {
    render(<AdminMessagesPage />);

    await waitFor(() => {
      expect(screen.getAllByText('User 1')[0]).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByText('User 1')[0]);

    const replyButton = await screen.findByText('Reply', { selector: 'button' });
    fireEvent.click(replyButton);

    const textArea = screen.getByPlaceholderText(/Type your reply/i);
    fireEvent.change(textArea, { target: { value: 'This is a reply' } });

    const sendButton = screen.getByText('Send Reply');
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith(
        expect.stringContaining('/contact/m1/reply'),
        expect.objectContaining({ message: 'This is a reply' })
      );
    });

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Reply sent'));
    });
  });

  it('handles delete message', async () => {
    render(<AdminMessagesPage />);

    await waitFor(() => {
      expect(screen.getAllByText('User 1')[0]).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByText('User 1')[0]);

    const deleteButton = await screen.findByTitle('Delete Message');
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(apiClient.delete).toHaveBeenCalledWith(expect.stringContaining('/contact/m1'));
    });
  });

  it('handles empty state', async () => {
    (apiClient.get as jest.Mock).mockResolvedValue({
      success: true,
      data: [],
      page: 1,
      pages: 1,
      total: 0,
      count: 0
    });

    render(<AdminMessagesPage />);

    await waitFor(() => {
      expect(screen.getByText('No messages found')).toBeInTheDocument();
    });
  });
});
