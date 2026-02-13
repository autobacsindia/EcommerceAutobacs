import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CreateVehiclePage from './page';
import apiClient from '@/lib/api';
import { useRouter } from 'next/navigation';

// Mock dependencies
jest.mock('@/lib/api');
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));
jest.mock('lucide-react', () => ({
  ArrowLeft: () => <span data-testid="icon-arrow-left">ArrowLeft</span>,
  Loader2: () => <span data-testid="icon-loader">Loader2</span>,
}));

describe('CreateVehiclePage', () => {
  const mockRouter = {
    push: jest.fn(),
    back: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
    (apiClient.post as jest.Mock).mockResolvedValue({ success: true });
    window.alert = jest.fn();
  });

  it('renders create vehicle form correctly', () => {
    render(<CreateVehiclePage />);
    
    expect(screen.getByText('Add New Vehicle')).toBeInTheDocument();
    expect(screen.getByLabelText(/Make/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Model/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Year/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Variant/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Slug/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Image URL/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Image Alt Text/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Active/i)).toBeChecked();
  });

  it('validates required fields', async () => {
    render(<CreateVehiclePage />);
    
    // Clear year since it has default value
    const yearInput = screen.getByLabelText(/Year/i);
    fireEvent.change(yearInput, { target: { value: '' } });

    const form = screen.getByRole('button', { name: /Create Vehicle/i }).closest('form');
    if (!form) throw new Error('Form not found');
    fireEvent.submit(form);
    
    await waitFor(() => {
      expect(screen.getByText('Make is required')).toBeInTheDocument();
      expect(screen.getByText('Model is required')).toBeInTheDocument();
      // Year validation might be different because input type is number
      // But we can check if api was called
    });
    
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('auto-generates slug from make, model and year', () => {
    render(<CreateVehiclePage />);
    
    fireEvent.change(screen.getByLabelText(/Make/i), { target: { value: 'Toyota' } });
    fireEvent.change(screen.getByLabelText(/Model/i), { target: { value: 'Camry' } });
    fireEvent.change(screen.getByLabelText(/Year/i), { target: { value: '2023' } });
    
    expect(screen.getByLabelText(/Slug/i)).toHaveValue('toyota-camry-2023');
  });

  it('submits form with valid data', async () => {
    render(<CreateVehiclePage />);
    
    fireEvent.change(screen.getByLabelText(/Make/i), { target: { value: 'Toyota' } });
    fireEvent.change(screen.getByLabelText(/Model/i), { target: { value: 'Camry' } });
    fireEvent.change(screen.getByLabelText(/Year/i), { target: { value: '2023' } });
    fireEvent.change(screen.getByLabelText(/Variant/i), { target: { value: 'Hybrid' } });
    fireEvent.change(screen.getByLabelText(/Image URL/i), { target: { value: 'http://example.com/image.jpg' } });
    
    const form = screen.getByRole('button', { name: /Create Vehicle/i }).closest('form');
    if (!form) throw new Error('Form not found');
    fireEvent.submit(form);
    
    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/vehicles', expect.objectContaining({
        make: 'Toyota',
        model: 'Camry',
        year: '2023',
        variant: 'Hybrid',
        slug: 'toyota-camry-2023',
        image: {
          url: 'http://example.com/image.jpg',
          alt: 'Toyota Camry'
        }
      }));
    });
    
    expect(window.alert).toHaveBeenCalledWith('Vehicle created successfully!');
    expect(mockRouter.push).toHaveBeenCalledWith('/admin/vehicles');
  });

  it('handles duplicate slug error', async () => {
    const error = new Error('duplicate key error');
    (apiClient.post as jest.Mock).mockRejectedValue(error);
    
    render(<CreateVehiclePage />);
    
    fireEvent.change(screen.getByLabelText(/Make/i), { target: { value: 'Toyota' } });
    fireEvent.change(screen.getByLabelText(/Model/i), { target: { value: 'Camry' } });
    
    const form = screen.getByRole('button', { name: /Create Vehicle/i }).closest('form');
    if (!form) throw new Error('Form not found');
    fireEvent.submit(form);
    
    await waitFor(() => {
      expect(screen.getByText(/This slug is already in use/i)).toBeInTheDocument();
    });
  });

  it('handles general API error', async () => {
    (apiClient.post as jest.Mock).mockRejectedValue(new Error('Failed to create'));
    
    render(<CreateVehiclePage />);
    
    fireEvent.change(screen.getByLabelText(/Make/i), { target: { value: 'Toyota' } });
    fireEvent.change(screen.getByLabelText(/Model/i), { target: { value: 'Camry' } });
    
    const form = screen.getByRole('button', { name: /Create Vehicle/i }).closest('form');
    if (!form) throw new Error('Form not found');
    fireEvent.submit(form);
    
    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith('Failed to create');
    });
  });
});
