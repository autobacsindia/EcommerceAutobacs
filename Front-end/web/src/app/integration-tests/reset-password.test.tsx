
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ResetPasswordPage from '../reset-password/page';
import apiClient from '@/lib/api';
import { useSearchParams } from 'next/navigation';

// Mock dependencies
jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

jest.mock('next/link', () => {
  return ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  );
});

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
}));

// Mock Lucide icons to avoid rendering issues
jest.mock('lucide-react', () => ({
  Loader2: () => <div data-testid="loader">Loading...</div>,
  ArrowLeft: () => <span>ArrowLeft</span>,
  CheckCircle: () => <span>CheckCircle</span>,
  AlertCircle: () => <span>AlertCircle</span>,
}));

describe('ResetPasswordPage Integration', () => {
  const mockGet = apiClient.get as jest.Mock;
  const mockPost = apiClient.post as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    (useSearchParams as jest.Mock).mockReturnValue({
      get: (key: string) => (key === 'token' ? 'valid-token' : null),
    });
  });

  it('verifies token on mount and shows form', async () => {
    mockGet.mockResolvedValueOnce({ success: true });
    
    render(<ResetPasswordPage />);
    
    // Initially verifying
    expect(screen.getByTestId('loader')).toBeInTheDocument();
    
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/auth/verify-reset-token?token=valid-token');
      // Should show form inputs
      expect(screen.getByLabelText(/^new password$/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/^confirm password$/i)).toBeInTheDocument();
    });
  });

  it('shows error for invalid token', async () => {
    const originalError = console.error;
    console.error = jest.fn(); // Suppress console.error
    
    try {
      mockGet.mockRejectedValueOnce(new Error('Invalid token'));
      
      render(<ResetPasswordPage />);
      
      await waitFor(() => {
        expect(screen.getByText(/invalid link/i)).toBeInTheDocument();
        expect(screen.getByText('Invalid token')).toBeInTheDocument();
      });
    } finally {
      console.error = originalError;
    }
  });

  it('validates password mismatch', async () => {
    mockGet.mockResolvedValueOnce({ success: true });
    
    render(<ResetPasswordPage />);
    
    await waitFor(() => {
      expect(screen.getByLabelText(/^new password$/i)).toBeInTheDocument();
    });
    
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText(/^confirm password$/i), { target: { value: 'mismatch' } });
    
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));
    
    await waitFor(() => {
      expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
    });
    
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('validates password length', async () => {
    mockGet.mockResolvedValueOnce({ success: true });
    
    render(<ResetPasswordPage />);
    
    await waitFor(() => {
      expect(screen.getByLabelText(/^new password$/i)).toBeInTheDocument();
    });
    
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: '123' } });
    fireEvent.change(screen.getByLabelText(/^confirm password$/i), { target: { value: '123' } });
    
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));
    
    await waitFor(() => {
      expect(screen.getByText(/password must be at least 6 characters/i)).toBeInTheDocument();
    });
    
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('submits valid password reset', async () => {
    mockGet.mockResolvedValueOnce({ success: true });
    mockPost.mockResolvedValueOnce({ success: true });
    
    render(<ResetPasswordPage />);
    
    await waitFor(() => {
      expect(screen.getByLabelText(/^new password$/i)).toBeInTheDocument();
    });
    
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: 'newpassword123' } });
    fireEvent.change(screen.getByLabelText(/^confirm password$/i), { target: { value: 'newpassword123' } });
    
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));
    
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/auth/reset-password', {
        token: 'valid-token',
        password: 'newpassword123',
      });
      expect(screen.getByText(/password reset successful/i)).toBeInTheDocument();
    });
  });
});
