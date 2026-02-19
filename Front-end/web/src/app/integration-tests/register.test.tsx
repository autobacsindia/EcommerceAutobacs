
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RegisterPage from '../register/page';
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

jest.mock('@/lib/hooks/useRateLimitTimer', () => ({
  useRateLimitTimer: jest.fn().mockReturnValue(null),
}));

jest.mock('@/lib/utils/navigation', () => ({
  navigateTo: jest.fn(),
}));

describe('RegisterPage Integration', () => {
  const mockRegister = jest.fn();
  const mockPush = jest.fn();
  const mockClearError = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue({ push: mockPush });
    (useAuth as jest.Mock).mockReturnValue({
      register: mockRegister,
      error: null,
      clearError: mockClearError,
    });
  });

  it('renders register form correctly', () => {
    render(<RegisterPage />);
    
    expect(screen.getByRole('heading', { name: /create account/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/your name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/re-enter password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue/i })).toBeInTheDocument();
  });

  it('validates required fields', async () => {
    render(<RegisterPage />);
    
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    
    await waitFor(() => {
      expect(screen.getByText(/enter your name/i)).toBeInTheDocument();
      expect(screen.getByText(/enter your email/i)).toBeInTheDocument();
      expect(screen.getByText(/enter your password/i)).toBeInTheDocument();
    });
    
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('validates password mismatch', async () => {
    render(<RegisterPage />);
    
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Test User' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText(/re-enter password/i), { target: { value: 'password456' } });
    
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    
    await waitFor(() => {
      expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
    });
    
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('submits form with valid data', async () => {
    mockRegister.mockResolvedValueOnce({ success: true });
    
    render(<RegisterPage />);
    
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Test User' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText(/re-enter password/i), { target: { value: 'password123' } });
    
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    
    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith('Test User', 'test@example.com', 'password123');
    });
  });
});
