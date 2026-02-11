import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';

// Mock apiClient
jest.mock('@/lib/api', () => ({
  get: jest.fn(),
  post: jest.fn(),
  getAuthToken: jest.fn(),
  setAuthToken: jest.fn(),
  clearAuthToken: jest.fn(),
}));

const TestComponent = () => {
  const { user, login, register, logout, isAuthenticated } = useAuth();
  
  return (
    <div>
      <div data-testid="auth-status">{isAuthenticated ? 'Authenticated' : 'Guest'}</div>
      <div data-testid="user-name">{user?.name}</div>
      <button onClick={() => login('test@example.com', 'password')}>Login</button>
      <button onClick={() => register('Test User', 'test@example.com', 'password')}>Register</button>
      <button onClick={() => logout()}>Logout</button>
    </div>
  );
};

describe('AuthContext', () => {
  const mockUser = {
    _id: 'user123',
    name: 'Test User',
    email: 'test@example.com',
    role: 'customer'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (apiClient.getAuthToken as jest.Mock).mockReturnValue(null);
  });

  it('should check auth on mount', async () => {
    (apiClient.getAuthToken as jest.Mock).mockReturnValue('fake-token');
    (apiClient.get as jest.Mock).mockResolvedValue({
      success: true,
      user: mockUser
    });

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith(API_ENDPOINTS.GET_ME);
    });

    expect(screen.getByTestId('auth-status')).toHaveTextContent('Authenticated');
    expect(screen.getByTestId('user-name')).toHaveTextContent('Test User');
  });

  it('should handle login success', async () => {
    (apiClient.post as jest.Mock).mockResolvedValue({
      success: true,
      accessToken: 'new-token',
      user: mockUser
    });

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    const loginButton = screen.getByText('Login');
    await act(async () => {
      loginButton.click();
    });

    expect(apiClient.post).toHaveBeenCalledWith(API_ENDPOINTS.LOGIN, {
      email: 'test@example.com',
      password: 'password'
    });
    
    expect(apiClient.setAuthToken).toHaveBeenCalledWith('new-token');
    expect(screen.getByTestId('auth-status')).toHaveTextContent('Authenticated');
  });

  it('should handle logout', async () => {
    // Start authenticated
    (apiClient.getAuthToken as jest.Mock).mockReturnValue('fake-token');
    (apiClient.get as jest.Mock).mockResolvedValue({
      success: true,
      user: mockUser
    });

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent('Authenticated');
    });

    const logoutButton = screen.getByText('Logout');
    await act(async () => {
      logoutButton.click();
    });

    expect(apiClient.clearAuthToken).toHaveBeenCalled();
    expect(screen.getByTestId('auth-status')).toHaveTextContent('Guest');
  });
});
