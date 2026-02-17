import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import ClientSearchSuggestions from './ClientSearchSuggestions';

// Mock the dynamically imported component
jest.mock('next/dynamic', () => ({
  __esModule: true,
  default: (loader: any, options: any) => {
    const MockComponent = () => <div data-testid="search-suggestions">Search Suggestions</div>;
    return MockComponent;
  },
}));

describe('ClientSearchSuggestions', () => {
  it('renders search suggestions component', async () => {
    render(<ClientSearchSuggestions />);
    
    await waitFor(() => {
      expect(screen.getByTestId('search-suggestions')).toBeInTheDocument();
    });
  });
});
