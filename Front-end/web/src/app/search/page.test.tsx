import { render, screen, waitFor } from '@testing-library/react';
import SearchPage from './page';
import { useSearchParams, useRouter } from 'next/navigation';

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useSearchParams: jest.fn(),
  useRouter: jest.fn(),
}));

// Mock fetch
global.fetch = jest.fn();

describe('SearchPage', () => {
  const mockPush = jest.fn();
  const mockSearchParams = new URLSearchParams();
  
  beforeEach(() => {
    (useRouter as jest.Mock).mockReturnValue({
      push: mockPush,
    });
    
    (useSearchParams as jest.Mock).mockReturnValue(mockSearchParams);
    
    (global.fetch as jest.Mock).mockClear();
    mockPush.mockClear();
  });

  it('renders search results page correctly', () => {
    mockSearchParams.set('search', 'test');
    
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        products: [],
        pagination: { total: 0 }
      }),
    });
    
    render(<SearchPage />);
    
    expect(screen.getByText('Search Results')).toBeInTheDocument();
    expect(screen.getByText('Found 0 results for "test"')).toBeInTheDocument();
  });

  it('displays "Did you mean?" suggestions when there are no results', async () => {
    mockSearchParams.set('search', 'tesst');
    
    // Mock product search response with no results
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        products: [],
        pagination: { total: 0 }
      }),
    });
    
    // Mock suggestions response with corrections
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        corrections: [
          { original: 'tesst', suggested: 'test', confidence: 0.8 }
        ]
      }),
    });
    
    render(<SearchPage />);
    
    await waitFor(() => {
      expect(screen.getByText('Did you mean:')).toBeInTheDocument();
      expect(screen.getByText('test')).toBeInTheDocument();
    });
  });

  it('does not display "Did you mean?" when there are results', async () => {
    mockSearchParams.set('search', 'test');
    
    // Mock product search response with results
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        products: [{ _id: '1', name: 'Test Product' }],
        pagination: { total: 1 }
      }),
    });
    
    render(<SearchPage />);
    
    await waitFor(() => {
      expect(screen.getByText('Showing 1 product of 1')).toBeInTheDocument();
    });
    
    // "Did you mean?" should not be present
    expect(screen.queryByText('Did you mean:')).not.toBeInTheDocument();
  });
});