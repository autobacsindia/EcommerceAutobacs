import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import LoginPage from './page';
import { useAuth } from '@/context/AuthContext';
import { navigateTo } from '@/lib/utils/navigation';

// Mock next/navigation
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

// Mock AuthContext
jest.mock('@/context/AuthContext', () => ({
  useAuth: jest.fn(),
}));

// Mock useRateLimitTimer
jest.mock('@/lib/hooks/useRateLimitTimer', () => ({
  useRateLimitTimer: () => null,
}));

// Mock navigation utility
jest.mock('@/lib/utils/navigation', () => ({
  navigateTo: jest.fn(),
}));

// Mock icons
jest.mock('lucide-react', () => ({
  Loader2: () => <div data-testid="loader">Loading...</div>,
  AlertCircle: () => <div data-testid="alert-icon">!</div>,
}));

jest.mock('react-icons/fc', () => ({
  FcGoogle: () => <div data-testid="google-icon">G</div>,
}));

jest.mock('react-icons/fa', () => ({
  FaFacebook: () => <div data-testid="facebook-icon">F</div>,
}));

// Mock BrandLogo
jest.mock('@/components/layout/BrandLogo', () => {
  return function MockBrandLogo() {
    return <div data-testid="brand-logo">AutoBacs</div>;
  };
});

describe('LoginPage', () => {
  const mockLogin = jest.fn();
  const mockClearError = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    // Default mock implementation
    (useAuth as jest.Mock).mockReturnValue({
      login: mockLogin,
      error: null,
      clearError: mockClearError,
    });
  });

  it('renders login form correctly', () => {
    render(<LoginPage />);
    
    expect(screen.getByText('Sign in')).toBeInTheDocument();
    expect(screen.getByLabelText(/Email or mobile phone number/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continue/i })).toBeInTheDocument();
    expect(screen.getByText('Google')).toBeInTheDocument();
    expect(screen.getByText('Facebook')).toBeInTheDocument();
  });

  it('validates required fields', async () => {
    render(<LoginPage />);
    
    const submitButton = screen.getByRole('button', { name: /Continue/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('Enter your email')).toBeInTheDocument();
      expect(screen.getByText('Enter your password')).toBeInTheDocument();
    });
    
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('validates email format', async () => {
    render(<LoginPage />);
    
    const emailInput = screen.getByLabelText(/Email or mobile phone number/i);
    fireEvent.change(emailInput, { target: { value: 'invalid-email' } });
    
    const submitButton = screen.getByRole('button', { name: /Continue/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('Enter a valid email address')).toBeInTheDocument();
    });
    
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('calls login and redirects on success', async () => {
    render(<LoginPage />);
    
    const emailInput = screen.getByLabelText(/Email or mobile phone number/i);
    const passwordInput = screen.getByLabelText(/Password/i);
    
    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'password123' } });
    
    const submitButton = screen.getByRole('button', { name: /Continue/i });
    await act(async () => {
      fireEvent.click(submitButton);
    });

    expect(mockLogin).toHaveBeenCalledWith('test@example.com', 'password123');
    expect(mockPush).toHaveBeenCalledWith('/');
  });

  it('displays auth error from context', () => {
    (useAuth as jest.Mock).mockReturnValue({
      login: mockLogin,
      error: 'Invalid credentials',
      clearError: mockClearError,
    });

    render(<LoginPage />);
    
    expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
  });

  it('clears error on input change', () => {
    (useAuth as jest.Mock).mockReturnValue({
      login: mockLogin,
      error: 'Invalid credentials',
      clearError: mockClearError,
    });

    render(<LoginPage />);
    
    const emailInput = screen.getByLabelText(/Email or mobile phone number/i);
    fireEvent.change(emailInput, { target: { value: 'new@example.com' } });
    
    expect(mockClearError).toHaveBeenCalled();
  });

  it('handles social login redirection', () => {
    render(<LoginPage />);
    
    const googleButton = screen.getByRole('button', { name: /Google/i });
    fireEvent.click(googleButton);

    expect(navigateTo).toHaveBeenCalledWith(expect.stringContaining('/auth/google'));
  });
});
