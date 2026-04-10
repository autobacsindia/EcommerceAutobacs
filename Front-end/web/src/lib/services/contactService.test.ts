/**
 * Contact Service Tests - Service-Level Testing Example
 * 
 * This demonstrates how to properly test services instead of mocking fetch/apiClient.
 * Services provide a clean abstraction layer that's easy to mock in component tests.
 */

import { ContactService } from './contactService';
import apiClient from '@/lib/api';

// Mock the API client at the service level
jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn()
  }
}));

describe('ContactService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('submit', () => {
    it('submits contact form successfully', async () => {
      const mockResponse = {
        success: true,
        message: 'Message sent successfully',
        data: {
          _id: 'msg_123',
          name: 'John Doe',
          email: 'john@example.com',
          subject: 'Test Subject',
          message: 'Test message',
          status: 'new'
        }
      };

      (apiClient.post as jest.Mock).mockResolvedValue(mockResponse);

      const result = await ContactService.submit({
        name: 'John Doe',
        email: 'john@example.com',
        subject: 'Test Subject',
        message: 'Test message'
      });

      expect(result.success).toBe(true);
      expect(result.data._id).toBe('msg_123');
      expect(apiClient.post).toHaveBeenCalledWith('/contact', {
        name: 'John Doe',
        email: 'john@example.com',
        subject: 'Test Subject',
        message: 'Test message'
      });
    });

    it('throws error on submission failure', async () => {
      const error = new Error('Rate limit exceeded');
      (apiClient.post as jest.Mock).mockRejectedValue(error);

      await expect(ContactService.submit({
        name: 'John',
        email: 'john@example.com',
        subject: 'Test',
        message: 'Hello'
      })).rejects.toThrow('Rate limit exceeded');
    });
  });

  describe('getAllMessages', () => {
    it('fetches all messages with filters', async () => {
      const mockResponse = {
        success: true,
        count: 2,
        data: [
          { _id: '1', name: 'John', status: 'new' },
          { _id: '2', name: 'Jane', status: 'replied' }
        ]
      };

      (apiClient.get as jest.Mock).mockResolvedValue(mockResponse);

      const result = await ContactService.getAllMessages({
        status: 'new',
        page: 1,
        limit: 10
      });

      expect(result.success).toBe(true);
      expect(result.count).toBe(2);
      expect(apiClient.get).toHaveBeenCalledWith('/contact?status=new&page=1&limit=10');
    });

    it('fetches all messages without filters', async () => {
      const mockResponse = {
        success: true,
        count: 5,
        data: []
      };

      (apiClient.get as jest.Mock).mockResolvedValue(mockResponse);

      const result = await ContactService.getAllMessages();

      expect(result.success).toBe(true);
      expect(apiClient.get).toHaveBeenCalledWith('/contact');
    });
  });

  describe('reply', () => {
    it('sends reply to contact message', async () => {
      const mockResponse = {
        success: true,
        data: {
          _id: 'msg_123',
          status: 'replied'
        }
      };

      (apiClient.post as jest.Mock).mockResolvedValue(mockResponse);

      const result = await ContactService.reply('msg_123', 'Thank you for your message!');

      expect(result.success).toBe(true);
      expect(result.data.status).toBe('replied');
      expect(apiClient.post).toHaveBeenCalledWith('/contact/msg_123/reply', {
        reply: 'Thank you for your message!'
      });
    });
  });

  describe('updateStatus', () => {
    it('updates message status', async () => {
      const mockResponse = {
        success: true,
        data: {
          _id: 'msg_123',
          status: 'closed'
        }
      };

      (apiClient.patch as jest.Mock).mockResolvedValue(mockResponse);

      const result = await ContactService.updateStatus('msg_123', 'closed');

      expect(result.success).toBe(true);
      expect(result.data.status).toBe('closed');
      expect(apiClient.patch).toHaveBeenCalledWith('/contact/msg_123/status', {
        status: 'closed'
      });
    });
  });

  describe('deleteMessage', () => {
    it('deletes contact message', async () => {
      const mockResponse = {
        success: true,
        message: 'Message deleted successfully'
      };

      (apiClient.delete as jest.Mock).mockResolvedValue(mockResponse);

      const result = await ContactService.deleteMessage('msg_123');

      expect(result.success).toBe(true);
      expect(result.message).toBe('Message deleted successfully');
      expect(apiClient.delete).toHaveBeenCalledWith('/contact/msg_123');
    });
  });
});

/**
 * Component Test Example - Using Service Mocks
 * 
 * This shows how to test a component that uses ContactService
 * without needing to mock the entire API client.
 */

/*
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ContactPage } from '@/app/contact/page';
import { ContactService } from '@/lib/services';

// Mock the service (not apiClient!)
jest.mock('@/lib/services', () => ({
  ContactService: {
    submit: jest.fn()
  }
}));

describe('ContactPage Component', () => {
  it('submits form and shows success message', async () => {
    // Mock service method
    (ContactService.submit as jest.Mock).mockResolvedValue({
      success: true,
      message: 'Message sent!'
    });

    render(<ContactPage />);

    // Fill form
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'John Doe' }
    });
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'john@example.com' }
    });
    fireEvent.change(screen.getByLabelText('Subject'), {
      target: { value: 'Test' }
    });
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'Hello!' }
    });

    // Submit
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    // Verify success
    await waitFor(() => {
      expect(screen.getByText(/thank you/i)).toBeInTheDocument();
    });

    // Verify service was called with correct data
    expect(ContactService.submit).toHaveBeenCalledWith({
      name: 'John Doe',
      email: 'john@example.com',
      subject: 'Test',
      message: 'Hello!'
    });
  });

  it('shows error message on submission failure', async () => {
    // Mock service to throw error
    (ContactService.submit as jest.Mock).mockRejectedValue(
      new Error('Rate limit exceeded')
    );

    render(<ContactPage />);

    // Fill and submit form
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'John' }
    });
    // ... fill other fields
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    // Verify error message
    await waitFor(() => {
      expect(screen.getByText(/rate limit/i)).toBeInTheDocument();
    });
  });
});
*/
