import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import RegisterPage from './page';
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

describe('RegisterPage', () => {
  const mockRegister = jest.fn();
  const mockClearError = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    // Default mock implementation
    (useAuth as jest.Mock).mockReturnValue({
      register: mockRegister,
      error: null,
      clearError: mockClearError,
    });
  });

  it('renders register form correctly', () => {
    render(<RegisterPage />);
    
    expect(screen.getByText('Create account')).toBeInTheDocument();
    expect(screen.getByLabelText(/Your name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Email$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Password$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Re-enter password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continue/i })).toBeInTheDocument();
  });

  it('validates required fields', async () => {
    render(<RegisterPage />);
    
    const submitButton = screen.getByRole('button', { name: /Continue/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('Enter your name')).toBeInTheDocument();
      expect(screen.getByText('Enter your email')).toBeInTheDocument();
      expect(screen.getByText('Enter your password')).toBeInTheDocument();
    });
    
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('validates password length', async () => {
    render(<RegisterPage />);
    
    const passwordInput = screen.getByLabelText(/^Password$/i);
    fireEvent.change(passwordInput, { target: { value: '123' } });
    
    const submitButton = screen.getByRole('button', { name: /Continue/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('Password must be at least 6 characters')).toBeInTheDocument();
    });
    
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('validates password match', async () => {
    render(<RegisterPage />);
    
    const passwordInput = screen.getByLabelText(/^Password$/i);
    const confirmPasswordInput = screen.getByLabelText(/Re-enter password/i);
    
    fireEvent.change(passwordInput, { target: { value: 'password123' } });
    fireEvent.change(confirmPasswordInput, { target: { value: 'password456' } });
    
    const submitButton = screen.getByRole('button', { name: /Continue/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    });
    
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('calls register and redirects on success', async () => {
    render(<RegisterPage />);
    
    fireEvent.change(screen.getByLabelText(/Your name/i), { target: { value: 'Test User' } });
    fireEvent.change(screen.getByLabelText(/^Email$/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText(/Re-enter password/i), { target: { value: 'password123' } });
    
    const submitButton = screen.getByRole('button', { name: /Continue/i });
    await act(async () => {
      fireEvent.click(submitButton);
    });

    expect(mockRegister).toHaveBeenCalledWith('Test User', 'test@example.com', 'password123');
    expect(mockPush).toHaveBeenCalledWith('/');
  });

  it('displays auth error from context', () => {
    (useAuth as jest.Mock).mockReturnValue({
      register: mockRegister,
      error: 'User already exists',
      clearError: mockClearError,
    });

    render(<RegisterPage />);
    
    expect(screen.getByText('User already exists')).toBeInTheDocument();
  });

  it('handles social login redirection', () => {
    render(<RegisterPage />);
    
    const googleButton = screen.getByRole('button', { name: /Google/i });
    fireEvent.click(googleButton);

    expect(navigateTo).toHaveBeenCalledWith(expect.stringContaining('/auth/google'));
  });
});
