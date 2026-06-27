import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CreateBrandPage from './page';
import apiClient from '@/lib/api';
import { useRouter } from 'next/navigation';
import { API_ENDPOINTS } from '@/lib/constants';

// Mock dependencies
jest.mock('@/lib/api');
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));
jest.mock('lucide-react', () => ({
  ArrowLeft: () => <span data-testid="icon-arrow-left">ArrowLeft</span>,
  Save: () => <span data-testid="icon-save">Save</span>,
  Loader2: () => <span data-testid="icon-loader">Loader</span>,
  // Icons used by the embedded <SeoPanel>.
  Search: () => <span data-testid="icon-search">Search</span>,
  ChevronDown: () => <span data-testid="icon-chevron-down">ChevronDown</span>,
  ChevronRight: () => <span data-testid="icon-chevron-right">ChevronRight</span>,
  Info: () => <span data-testid="icon-info">Info</span>,
}));
// Mock constants if needed, but usually we can import them. 
// If API_ENDPOINTS is not mocked, it uses real values.
// We should check what the real value is or just match whatever is passed.

describe('CreateBrandPage', () => {
  const mockRouter = {
    back: jest.fn(),
    push: jest.fn(),
    refresh: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
    (apiClient.post as jest.Mock).mockResolvedValue({ success: true });
    window.alert = jest.fn();
  });

  it('renders form elements', () => {
    render(<CreateBrandPage />);
    expect(screen.getByLabelText(/Brand Name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Logo URL/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Description/i)).toBeInTheDocument();
  });

  it('handles input changes and preview generation', () => {
    render(<CreateBrandPage />);
    
    const nameInput = screen.getByLabelText(/Brand Name/i);
    fireEvent.change(nameInput, { target: { value: 'Test Brand 123' } });
    
    expect(nameInput).toHaveValue('Test Brand 123');
    // The component converts to lowercase and replaces non-alphanumeric with hyphens
    expect(screen.getByText('test-brand-123')).toBeInTheDocument();
    
    const logoInput = screen.getByLabelText(/Logo URL/i);
    fireEvent.change(logoInput, { target: { value: 'http://example.com/logo.png' } });
    expect(logoInput).toHaveValue('http://example.com/logo.png');
    
    // Check if image preview appears
    expect(screen.getByAltText('Logo preview')).toBeInTheDocument();
  });

  it('submits form successfully', async () => {
    render(<CreateBrandPage />);
    
    fireEvent.change(screen.getByLabelText(/Brand Name/i), { target: { value: 'New Brand' } });
    fireEvent.change(screen.getByLabelText(/Logo URL/i), { target: { value: 'http://logo.com' } });
    fireEvent.change(screen.getByLabelText(/Description/i), { target: { value: 'Desc' } });
    
    const submitButton = screen.getByRole('button', { name: /Create Brand/i });
    fireEvent.click(submitButton);
    
    await waitFor(() => {
      // We can use expect.anything() for the URL if we are not sure about the constant value,
      // or import it. Since we imported it, let's use it.
      expect(apiClient.post).toHaveBeenCalledWith(API_ENDPOINTS.BRAND_CREATE, {
        name: 'New Brand',
        logo: 'http://logo.com',
        description: 'Desc',
        // SeoPanel defaults sent when no SEO override is entered.
        seo: {
          metaTitle: '',
          metaDescription: '',
          canonical: '',
          ogImage: '',
          noindex: false,
          focusKeyword: '',
        },
      });
    });
    
    expect(window.alert).toHaveBeenCalledWith('Brand created successfully!');
    expect(mockRouter.push).toHaveBeenCalledWith('/admin/brands');
  });

  it('handles submission error', async () => {
    (apiClient.post as jest.Mock).mockRejectedValue(new Error('Creation failed'));
    
    render(<CreateBrandPage />);
    
    fireEvent.change(screen.getByLabelText(/Brand Name/i), { target: { value: 'Fail Brand' } });
    const submitButton = screen.getByRole('button', { name: /Create Brand/i });
    fireEvent.click(submitButton);
    
    await waitFor(() => {
      expect(screen.getByText('Creation failed')).toBeInTheDocument();
    });
  });

  it('validates required fields', async () => {
    render(<CreateBrandPage />);
    
    const form = screen.getByRole('button', { name: /Create Brand/i }).closest('form');
    if (!form) throw new Error('Form not found');
    fireEvent.submit(form);
    
    await waitFor(() => {
      expect(screen.getByText('Brand name is required')).toBeInTheDocument();
    });
    
    expect(apiClient.post).not.toHaveBeenCalled();
  });
});
