import React, { Suspense } from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import EditVehiclePage from './page';
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

// Helper to render with Suspense
const renderWithSuspense = (ui: React.ReactNode) => {
  return render(
    <Suspense fallback={<div>Loading Params...</div>}>
      {ui}
    </Suspense>
  );
};

describe('EditVehiclePage', () => {
  const mockRouter = {
    push: jest.fn(),
    back: jest.fn(),
  };

  const mockVehicle = {
    _id: 'v1',
    make: 'Toyota',
    model: 'Camry',
    slug: 'toyota-camry',
    image: {
      url: 'http://example.com/camry.jpg',
      alt: 'Toyota Camry SE'
    },
    isActive: true
  };

  const mockParams = Promise.resolve({ id: 'v1' });

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
    (apiClient.get as jest.Mock).mockResolvedValue({ success: true, vehicle: mockVehicle });
    (apiClient.put as jest.Mock).mockResolvedValue({ success: true });
    window.alert = jest.fn();
    window.confirm = jest.fn().mockReturnValue(true);
  });

  it('renders initial loading state', async () => {
    // This test serves as a warmup for Suspense/use(promise) in Jest
    renderWithSuspense(<EditVehiclePage params={mockParams} />);
    // We don't assert completion here to avoid stuck state failing the test
    expect(screen.getByText('Loading Params...')).toBeInTheDocument();
  });

  it('fetches and populates vehicle data', async () => {
    renderWithSuspense(<EditVehiclePage params={mockParams} />);
    
    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith('/vehicles/v1');
      expect(screen.getByLabelText(/Make/i)).toHaveValue('Toyota');
      expect(screen.getByLabelText(/Model/i)).toHaveValue('Camry');
      expect(screen.getByLabelText(/Slug/i)).toHaveValue('toyota-camry');
      expect(screen.getByLabelText(/Image URL/i)).toHaveValue('http://example.com/camry.jpg');
    });
  });

  it('updates vehicle successfully', async () => {
    renderWithSuspense(<EditVehiclePage params={mockParams} />);
    
    await waitFor(() => {
      expect(screen.getByLabelText(/Make/i)).toHaveValue('Toyota');
    });
    
    fireEvent.change(screen.getByLabelText(/Model/i), { target: { value: 'Corolla' } });

    const form = screen.getByRole('button', { name: /Update Vehicle/i }).closest('form');
    if (!form) throw new Error('Form not found');
    fireEvent.submit(form);

    await waitFor(() => {
      expect(apiClient.put).toHaveBeenCalledWith('/vehicles/v1', expect.objectContaining({
        make: 'Toyota',
        model: 'Corolla',
        slug: 'toyota-corolla',
        image: {
          url: 'http://example.com/camry.jpg',
          alt: 'Toyota Camry SE'
        }
      }));
    });
    
    expect(window.alert).toHaveBeenCalledWith('Vehicle updated successfully!');
    expect(mockRouter.push).toHaveBeenCalledWith('/admin/vehicles');
  });

  it('handles fetch error', async () => {
    (apiClient.get as jest.Mock).mockRejectedValue(new Error('Vehicle not found'));
    
    renderWithSuspense(<EditVehiclePage params={mockParams} />);
    
    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith('Vehicle not found');
      expect(mockRouter.push).toHaveBeenCalledWith('/admin/vehicles');
    });
  });

  it('handles update error', async () => {
    renderWithSuspense(<EditVehiclePage params={mockParams} />);
    
    await waitFor(() => {
      expect(screen.getByLabelText(/Make/i)).toHaveValue('Toyota');
    });
    
    (apiClient.put as jest.Mock).mockRejectedValue(new Error('Update failed'));
    
    const form = screen.getByRole('button', { name: /Update Vehicle/i }).closest('form');
    if (!form) throw new Error('Form not found');
    fireEvent.submit(form);
    
    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith('Update failed');
    });
  });
});
