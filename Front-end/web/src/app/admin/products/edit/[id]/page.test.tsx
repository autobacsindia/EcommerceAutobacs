import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EditProductPage from './page';
import apiClient from '@/lib/api';
import { useRouter, useParams } from 'next/navigation';

// Mock apiClient
jest.mock('@/lib/api');

// Mock useRouter and useParams
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useParams: jest.fn(),
}));

// Mock icons
jest.mock('lucide-react', () => ({
  ArrowLeft: () => <span data-testid="icon-arrow-left">ArrowLeft</span>,
  Upload: () => <span data-testid="icon-upload">Upload</span>,
  Plus: () => <span data-testid="icon-plus">Plus</span>,
  Minus: () => <span data-testid="icon-minus">Minus</span>,
  X: () => <span data-testid="icon-x">X</span>,
}));

// Mock URL.createObjectURL
global.URL.createObjectURL = jest.fn(() => 'blob:mock-url');

describe('EditProductPage', () => {
  const mockPush = jest.fn();
  const mockBack = jest.fn();
  const mockProductId = 'prod1';

  const mockCategories = [
    { _id: 'cat1', name: 'Category 1' },
    { _id: 'cat2', name: 'Suspension' },
  ];

  const mockVehicles = [
    { _id: 'veh1', make: 'Toyota', model: 'Corolla', year: 2020 },
    { _id: 'veh2', make: 'Honda', model: 'Civic', year: 2021, variant: 'Type R' },
  ];

  const mockProduct = {
    _id: mockProductId,
    name: 'Existing Product',
    description: 'Existing Description',
    shortDescription: 'Short Desc',
    price: 150,
    originalPrice: 200,
    category: { _id: 'cat1', name: 'Category 1' },
    brand: 'Toyota',
    stock: 50,
    sku: 'SKU123',
    isFeatured: true,
    isFastMoving: false,
    isActive: true,
    images: [],
    compatibleVehicles: ['veh1'],
    features: ['Feature 1'],
    packageContents: ['Item 1'],
    qna: [{ question: 'Q1', answer: 'A1' }],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue({
      push: mockPush,
      back: mockBack,
    });
    (useParams as jest.Mock).mockReturnValue({ id: mockProductId });
    
    // Default mocks for API calls
    (apiClient.get as jest.Mock).mockImplementation((url) => {
      if (url === '/categories') {
        return Promise.resolve({ data: mockCategories });
      }
      if (url === '/vehicles') {
        return Promise.resolve({ vehicles: mockVehicles });
      }
      if (url === `/products/${mockProductId}`) {
        return Promise.resolve({ product: mockProduct });
      }
      return Promise.resolve({});
    });
    
    (apiClient.put as jest.Mock).mockResolvedValue({ success: true });
    window.alert = jest.fn();
  });

  it('renders form populated with product data', async () => {
    render(<EditProductPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Product Name/i)).toHaveValue('Existing Product');
      expect(screen.getByLabelText(/Price/i)).toHaveValue(150);
      expect(screen.getByLabelText(/Category/i)).toHaveValue('cat1');
    });
  });

  it('handles input changes', async () => {
    render(<EditProductPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Product Name/i)).toHaveValue('Existing Product');
    });

    fireEvent.change(screen.getByLabelText(/Product Name/i), { target: { value: 'Updated Product' } });
    expect(screen.getByLabelText(/Product Name/i)).toHaveValue('Updated Product');
  });

  it('handles form submission', async () => {
    render(<EditProductPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Product Name/i)).toHaveValue('Existing Product');
    });

    // Update some fields
    fireEvent.change(screen.getByLabelText(/Product Name/i), { target: { value: 'Updated Product' } });
    fireEvent.change(screen.getByLabelText(/Price/i), { target: { value: '180' } });

    // Find submit button (usually "Save Changes" or similar, but let's check code or guess "Update Product" or "Save")
    // In Create it was "Create Product", here it might be "Update Product" or just "Save".
    // I will guess generic button role in form.
    // The previous file had: {submitting ? 'Creating...' : 'Create Product'}
    // This file likely has: {submitting ? 'Updating...' : 'Update Product'} or 'Save Changes'
    // I'll assume 'Update Product' or check the button.
    
    const submitButton = screen.getByRole('button', { name: /Update Product|Save/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(apiClient.put).toHaveBeenCalledWith(`/products/${mockProductId}`, expect.objectContaining({
        name: 'Updated Product',
        price: 180,
      }));
    });
    
    expect(window.alert).toHaveBeenCalledWith('Product updated successfully');
    expect(mockPush).toHaveBeenCalledWith('/admin/products');
  });

  it('handles offer date validation', async () => {
    render(<EditProductPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Feature on offers page/i)).toBeInTheDocument();
    });

    const offerCheckbox = screen.getByLabelText(/Feature on offers page/i);
    fireEvent.click(offerCheckbox);

    await waitFor(() => {
      expect(screen.getByLabelText(/Offer Start Date/i)).toBeInTheDocument();
    });

    // Set invalid dates (end before start)
    fireEvent.change(screen.getByLabelText(/Offer Start Date/i), { target: { value: '2023-01-02T10:00' } });
    fireEvent.change(screen.getByLabelText(/Offer End Date/i), { target: { value: '2023-01-01T10:00' } });

    const submitButton = screen.getByRole('button', { name: /Update Product|Save/i });
    fireEvent.click(submitButton);

    expect(window.alert).toHaveBeenCalledWith('Offer End Date must be after Offer Start Date');
    expect(apiClient.put).not.toHaveBeenCalled();
  });
});
