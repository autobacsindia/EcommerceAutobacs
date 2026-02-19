
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LoginPage from '../login/page'; // Adjust path if needed
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';

// Mock dependencies
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

jest.mock('@/context/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('@/components/layout/BrandLogo', () => {
  return function MockBrandLogo() {
    return <div data-testid="brand-logo">Brand Logo</div>;
  };
});

describe('LoginPage Integration', () => {
  const mockLogin = jest.fn();
  const mockPush = jest.fn();
  const mockClearError = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue({ push: mockPush });
    (useAuth as jest.Mock).mockReturnValue({
      login: mockLogin,
      error: null,
      clearError: mockClearError,
      user: null,
    });
  });

  it('renders login form correctly', () => {
    render(<LoginPage />);
    
    expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue/i })).toBeInTheDocument();
  });

  it('validates required fields', async () => {
    render(<LoginPage />);
    
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    
    await waitFor(() => {
      // Check for validation messages - exact text might vary, checking for content
      // Based on code: errors.email = 'Enter your email'
      // errors.password = 'Enter your password'
      expect(screen.getByText(/enter your email/i)).toBeInTheDocument();
      expect(screen.getByText(/enter your password/i)).toBeInTheDocument();
    });
    
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('validates email format', async () => {
    render(<LoginPage />);
    
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'invalid-email' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password123' } });
    
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    
    await waitFor(() => {
      expect(screen.getByText(/enter a valid email address/i)).toBeInTheDocument();
    });
    
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('submits form with valid data', async () => {
    mockLogin.mockResolvedValueOnce({ success: true });
    
    render(<LoginPage />);
    
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password123' } });
    
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    
    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('test@example.com', 'password123');
    });
    
    // Should navigate to home on success
    // The component uses router.push('/') on success
    // Wait for the promise to resolve in the component
    // We can't easily wait for the internal promise unless we mock it to resolve immediately
    // mockLogin returns a promise.
  });

  it('handles login error', async () => {
    // Simulate error state from context
    (useAuth as jest.Mock).mockReturnValue({
      login: mockLogin,
      error: 'Invalid credentials',
      clearError: mockClearError,
      user: null,
    });

    render(<LoginPage />);
    
    expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument();
  });
});
