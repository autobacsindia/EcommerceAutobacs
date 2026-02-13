import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CreateCategoryPage from './page';
import apiClient from '@/lib/api';
import { useRouter } from 'next/navigation';

// Mock dependencies
jest.mock('@/lib/api');
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));
jest.mock('lucide-react', () => ({
  ArrowLeft: () => <span data-testid="icon-arrow-left">ArrowLeft</span>,
  Upload: () => <span data-testid="icon-upload">Upload</span>,
}));

describe('CreateCategoryPage', () => {
  const mockRouter = {
    back: jest.fn(),
    push: jest.fn(),
    refresh: jest.fn(),
  };

  const mockCategories = [
    { _id: 'c1', name: 'Parent Category 1' },
    { _id: 'c2', name: 'Parent Category 2' },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
    (apiClient.get as jest.Mock).mockResolvedValue({ data: mockCategories });
    (apiClient.post as jest.Mock).mockResolvedValue({ success: true });
    
    // Mock URL.createObjectURL
    global.URL.createObjectURL = jest.fn(() => 'blob:http://localhost:3000/test-blob');
  });

  it('renders form elements', async () => {
    render(<CreateCategoryPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/^Name/i)).toBeInTheDocument(); // ^Name to match "Name *"
      expect(screen.getByLabelText(/^Slug/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Parent Category/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Description/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Category Image/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Order/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Active/i)).toBeInTheDocument();
    });
  });

  it('fetches and displays parent categories', async () => {
    render(<CreateCategoryPage />);

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith('/categories');
    });
    
    const parentSelect = await screen.findByLabelText(/Parent Category/i);
    expect(parentSelect).toBeInTheDocument();
    expect(screen.getByText('Parent Category 1')).toBeInTheDocument();
    expect(screen.getByText('Parent Category 2')).toBeInTheDocument();
  });

  it('handles validation errors', async () => {
    render(<CreateCategoryPage />);
    
    // Wait for initial fetch
    await waitFor(() => expect(apiClient.get).toHaveBeenCalled());

    const submitButton = screen.getByRole('button', { name: /Create Category/i });
    fireEvent.click(submitButton);
    
    await waitFor(() => {
      expect(screen.getByText(/Category name is required/i)).toBeInTheDocument();
    });
    
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('submits form with valid data', async () => {
    render(<CreateCategoryPage />);

    await waitFor(() => expect(apiClient.get).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'New Category' } });
    fireEvent.change(screen.getByLabelText(/^Slug/i), { target: { value: 'new-category' } });
    fireEvent.change(screen.getByLabelText(/Description/i), { target: { value: 'Test Description' } });
    fireEvent.change(screen.getByLabelText(/Order/i), { target: { value: '10' } });
    
    const submitButton = screen.getByRole('button', { name: /Create Category/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/categories', expect.objectContaining({
        name: 'New Category',
        slug: 'new-category',
        description: 'Test Description',
        order: "10",
        isActive: true
      }));
    });
    
    expect(mockRouter.push).toHaveBeenCalledWith('/admin/categories');
  });

  it('handles image upload preview', async () => {
    render(<CreateCategoryPage />);
    
    // Wait for initial fetch
    await waitFor(() => expect(apiClient.get).toHaveBeenCalled());

    const file = new File(['(⌐□_□)'], 'chucknorris.png', { type: 'image/png' });
    const input = screen.getByLabelText(/Category Image/i);
    
    fireEvent.change(input, { target: { files: [file] } });
    
    await waitFor(() => {
      expect(global.URL.createObjectURL).toHaveBeenCalledWith(file);
      expect(screen.getByAltText('Preview')).toBeInTheDocument();
    });
    
    // Check if Alt text input appears after image upload
    expect(screen.getByLabelText(/Image Alt Text/i)).toBeInTheDocument();
  });

  it('handles API error on submission', async () => {
    (apiClient.post as jest.Mock).mockRejectedValue(new Error('API Error'));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    render(<CreateCategoryPage />);

    await waitFor(() => expect(apiClient.get).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'New Category' } });
    fireEvent.change(screen.getByLabelText(/^Slug/i), { target: { value: 'new-category' } });
    
    const submitButton = screen.getByRole('button', { name: /Create Category/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/API Error/i)).toBeInTheDocument();
    });

    consoleSpy.mockRestore();
  });
});
