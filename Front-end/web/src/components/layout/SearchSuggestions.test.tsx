import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SearchSuggestions from './SearchSuggestions';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLocation } from '@/context/LocationContext';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  usePathname: jest.fn(),
}));

jest.mock('@/context/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('@/context/LocationContext', () => ({
  useLocation: jest.fn(),
}));

const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

describe('SearchSuggestions', () => {
  const mockPush = jest.fn();
  
  beforeEach(() => {
    (useRouter as jest.Mock).mockReturnValue({ push: mockPush });
    (useAuth as jest.Mock).mockReturnValue({
      user: null,
      isAuthenticated: false,
    });
    (useLocation as jest.Mock).mockReturnValue({
      currentLocation: null,
    });

    localStorageMock.getItem.mockClear();
    localStorageMock.setItem.mockClear();
    localStorageMock.removeItem.mockClear();
    mockPush.mockClear();
  });

  it('renders search input correctly', () => {
    render(<SearchSuggestions />);
    expect(screen.getByPlaceholderText('Search products, brands, categories...')).toBeInTheDocument();
  });

  it('does not show search history on mount even if history exists', async () => {
    const mockHistory = [
      { term: 'wheel', timestamp: Date.now() },
    ];
    localStorageMock.getItem.mockReturnValue(JSON.stringify(mockHistory));

    render(<SearchSuggestions />);
    
    // Should NOT show Recent Searches initially
    expect(screen.queryByText('Recent Searches')).not.toBeInTheDocument();

    // After focus, it SHOULD show
    const input = screen.getByPlaceholderText('Search products, brands, categories...');
    fireEvent.focus(input);
    
    await waitFor(() => {
      expect(screen.getByText('Recent Searches')).toBeInTheDocument();
    });
  });

  it('shows search history when input is empty', async () => {
    const mockHistory = [
      { term: 'wheel', timestamp: Date.now() },
      { term: 'brake', timestamp: Date.now() - 1000 },
    ];
    
    localStorageMock.getItem.mockReturnValue(JSON.stringify(mockHistory));
    
    render(<SearchSuggestions />);
    const input = screen.getByPlaceholderText('Search products, brands, categories...');
    
    fireEvent.focus(input);
    
    await waitFor(() => {
      expect(screen.getByText('Recent Searches')).toBeInTheDocument();
      expect(screen.getByText('wheel')).toBeInTheDocument();
      expect(screen.getByText('brake')).toBeInTheDocument();
    });
  });

  it('saves search terms to history when searching', async () => {
    render(<SearchSuggestions />);
    const input = screen.getByPlaceholderText('Search products, brands, categories...');
    const searchButton = screen.getByRole('button', { name: 'Search' });
    
    fireEvent.change(input, { target: { value: 'test product' } });
    fireEvent.click(searchButton);

    expect(mockPush).toHaveBeenCalledWith('/products/search?search=test%20product');
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'searchHistory_guest_global',
      expect.stringContaining('test product')
    );
  });

  it('uses user-specific key for history when logged in', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: {
        _id: 'user123',
        name: 'Test User',
        email: 'test@example.com',
        role: 'customer',
      },
      isAuthenticated: true,
    });
    
    render(<SearchSuggestions />);
    const input = screen.getByPlaceholderText('Search products, brands, categories...');
    const searchButton = screen.getByRole('button', { name: 'Search' });
    
    fireEvent.change(input, { target: { value: 'bull bar' } });
    fireEvent.click(searchButton);
    
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'searchHistory_user123_global',
      expect.stringContaining('bull bar')
    );
  });

  it('uses location-specific key for history', async () => {
    (useLocation as jest.Mock).mockReturnValue({
      currentLocation: {
        selectedAddress: {
          postalCode: '100001',
        },
      },
    });
    
    render(<SearchSuggestions />);
    const input = screen.getByPlaceholderText('Search products, brands, categories...');
    const searchButton = screen.getByRole('button', { name: 'Search' });
    
    fireEvent.change(input, { target: { value: 'tire' } });
    fireEvent.click(searchButton);
    
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'searchHistory_guest_100001',
      expect.stringContaining('tire')
    );
  });

  it('uses user and location specific key for history', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: {
        _id: 'user123',
        name: 'Test User',
        email: 'test@example.com',
        role: 'customer',
      },
      isAuthenticated: true,
    });
    (useLocation as jest.Mock).mockReturnValue({
      currentLocation: {
        selectedAddress: {
          postalCode: '100001',
        },
      },
    });
    
    render(<SearchSuggestions />);
    const input = screen.getByPlaceholderText('Search products, brands, categories...');
    const searchButton = screen.getByRole('button', { name: 'Search' });
    
    fireEvent.change(input, { target: { value: 'battery' } });
    fireEvent.click(searchButton);
    
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'searchHistory_user123_100001',
      expect.stringContaining('battery')
    );
  });

  it('navigates to search page when suggestion is clicked', async () => {
    render(<SearchSuggestions />);
    const input = screen.getByPlaceholderText('Search products, brands, categories...');
    
    fireEvent.change(input, { target: { value: 'test' } });
    
    // Simulate suggestions being fetched
    // In a real test, we would mock the fetch API
    // For now, we'll just test that the component renders without errors
  });

  it('handles keyboard navigation', async () => {
    const mockHistory = [
      { term: 'wheel', timestamp: Date.now() },
      { term: 'brake', timestamp: Date.now() - 1000 },
    ];
    
    localStorageMock.getItem.mockReturnValue(JSON.stringify(mockHistory));
    
    render(<SearchSuggestions />);
    const input = screen.getByPlaceholderText('Search products, brands, categories...');
    
    fireEvent.focus(input);
    
    await waitFor(() => {
      expect(screen.getByText('Recent Searches')).toBeInTheDocument();
    });
    
    // Test arrow key navigation
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    
    // Should navigate to search with the first history item
    expect(mockPush).toHaveBeenCalledWith('/products/search?search=wheel');
  });
});
