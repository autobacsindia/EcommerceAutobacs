import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminQuestionsPage from './page';
import apiClient from '@/lib/api';

// Mock apiClient
jest.mock('@/lib/api');

// Mock icons
jest.mock('lucide-react', () => ({
  MessageSquare: () => <span data-testid="icon-message">Message</span>,
  Search: () => <span data-testid="icon-search">Search</span>,
  CheckCircle: () => <span data-testid="icon-check">Check</span>,
  XCircle: () => <span data-testid="icon-x">X</span>,
  Clock: () => <span data-testid="icon-clock">Clock</span>,
  MoreVertical: () => <span data-testid="icon-more">More</span>,
  Edit2: () => <span data-testid="icon-edit">Edit</span>,
  Trash2: () => <span data-testid="icon-trash">Trash</span>,
  Filter: () => <span data-testid="icon-filter">Filter</span>,
}));

describe('AdminQuestionsPage', () => {
  const mockQuestions = [
    {
      _id: 'q1',
      product: { _id: 'p1', name: 'Product 1' },
      userName: 'User 1',
      email: 'user1@example.com',
      question: 'Question 1',
      status: 'pending',
      isPublic: false,
      createdAt: '2023-01-01T00:00:00Z',
    },
    {
      _id: 'q2',
      product: { _id: 'p2', name: 'Product 2' },
      userName: 'User 2',
      email: 'user2@example.com',
      question: 'Question 2',
      answer: 'Answer 2',
      status: 'answered',
      isPublic: true,
      createdAt: '2023-01-02T00:00:00Z',
    },
  ];

  const mockResponse = {
    success: true,
    data: mockQuestions,
    page: 1,
    pages: 2,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (apiClient.get as jest.Mock).mockResolvedValue(mockResponse);
    (apiClient.put as jest.Mock).mockResolvedValue({ success: true });
    (apiClient.delete as jest.Mock).mockResolvedValue({ success: true });
    window.confirm = jest.fn().mockReturnValue(true);
    window.alert = jest.fn();
  });

  it('renders questions list', async () => {
    render(<AdminQuestionsPage />);

    await waitFor(() => {
      expect(screen.getByText('Product 1')).toBeInTheDocument();
      expect(screen.getByText('Question 1')).toBeInTheDocument();
      // Filter option and badge both have "Pending"
      const pendingElements = screen.getAllByText(/Pending/i);
      expect(pendingElements.length).toBeGreaterThan(0);

      expect(screen.getByText('Product 2')).toBeInTheDocument();
      // Match "Answer 2" which is the dynamic part
      expect(screen.getByText('Answer 2')).toBeInTheDocument();
      // Filter option and badge both have "Answered"
      const answeredElements = screen.getAllByText(/Answered/i);
      expect(answeredElements.length).toBeGreaterThan(0);
    });
  });

  it('handles filtering', async () => {
    render(<AdminQuestionsPage />);

    await waitFor(() => {
      expect(screen.getByText('Product 1')).toBeInTheDocument();
    });

    const filterSelect = screen.getByRole('combobox');
    fireEvent.change(filterSelect, { target: { value: 'pending' } });

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining('status=pending'));
    });
  });

  it('handles pagination', async () => {
    render(<AdminQuestionsPage />);

    await waitFor(() => {
      expect(screen.getByText('Next')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Next'));

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining('pageNumber=2'));
    });
  });

  it('handles delete question', async () => {
    render(<AdminQuestionsPage />);

    await waitFor(() => {
      expect(screen.getByText('Product 1')).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByText('Delete');
    fireEvent.click(deleteButtons[0]);

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => {
      expect(apiClient.delete).toHaveBeenCalledWith('/product-questions/q1');
    });
  });

  it('handles answering a question', async () => {
    render(<AdminQuestionsPage />);

    await waitFor(() => {
      expect(screen.getByText('Product 1')).toBeInTheDocument();
    });

    const replyButtons = screen.getAllByText('Reply');
    fireEvent.click(replyButtons[0]);

    // Modal should open
    expect(screen.getByText('Reply to User 1')).toBeInTheDocument();
    
    // Check for question content text
    const questionTexts = screen.getAllByText('Question 1');
    expect(questionTexts.length).toBeGreaterThan(0);

    const textarea = screen.getByPlaceholderText('Type your answer here...');
    fireEvent.change(textarea, { target: { value: 'My Answer' } });

    const submitButton = screen.getByText('Send Reply');
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(apiClient.put).toHaveBeenCalledWith('/product-questions/q1/answer', {
        answer: 'My Answer',
        isPublic: false, // Default from mock data (isPublic: false) or component state? 
        // Component state init: setIsPublic(question.isPublic !== false);
        // question 1 has isPublic: false, so setIsPublic(false)
      });
    });
  });

  it('handles empty state', async () => {
    (apiClient.get as jest.Mock).mockResolvedValue({
      success: true,
      data: [],
      page: 1,
      pages: 1,
    });

    render(<AdminQuestionsPage />);

    await waitFor(() => {
      expect(screen.getByText('No questions found')).toBeInTheDocument();
    });
  });
});
