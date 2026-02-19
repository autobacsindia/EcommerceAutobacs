
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ForgotPasswordPage from '../forgot-password/page';
import apiClient from '@/lib/api';

// Mock dependencies
jest.mock('@/lib/api', () => ({
  post: jest.fn(),
}));

jest.mock('next/link', () => {
  return ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  );
});

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

describe('ForgotPasswordPage Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders forgot password form correctly', () => {
    render(<ForgotPasswordPage />);
    
    expect(screen.getByRole('heading', { name: /forgot password/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('submits form with email and shows success message', async () => {
    (apiClient.post as jest.Mock).mockResolvedValueOnce({ success: true });
    
    render(<ForgotPasswordPage />);
    
    const emailInput = screen.getByLabelText(/email address/i);
    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    
    const submitButton = screen.getByRole('button');
    fireEvent.click(submitButton);
    
    // Check loading state if possible, but it might be too fast
    // await waitFor(() => expect(submitButton).toBeDisabled());
    
    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/auth/forgot-password', { email: 'test@example.com' });
      expect(screen.getByText(/check your email/i)).toBeInTheDocument();
      expect(screen.getByText(/test@example.com/i)).toBeInTheDocument();
    });
  });

  it('handles submission error', async () => {
    const originalError = console.error;
    console.error = jest.fn(); // Suppress console.error
    
    try {
      (apiClient.post as jest.Mock).mockRejectedValueOnce(new Error('User not found'));
      
      render(<ForgotPasswordPage />);
      
      const emailInput = screen.getByLabelText(/email address/i);
      fireEvent.change(emailInput, { target: { value: 'nonexistent@example.com' } });
      
      fireEvent.click(screen.getByRole('button'));
      
      await waitFor(() => {
        expect(screen.getByText(/user not found/i)).toBeInTheDocument();
      });
    } finally {
      console.error = originalError;
    }
  });

  it('validates empty email submission', async () => {
    render(<ForgotPasswordPage />);
    
    // The button submits the form. The input has 'required' attribute, 
    // but JSDOM doesn't fully validate HTML5 validation on submit unless we use fireEvent.submit on form
    // However, the component code checks: if (!email) return;
    
    const submitButton = screen.getByRole('button');
    fireEvent.click(submitButton);
    
    // Should not call API
    expect(apiClient.post).not.toHaveBeenCalled();
  });
});
