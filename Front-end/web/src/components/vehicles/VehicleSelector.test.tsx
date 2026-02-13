import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import VehicleSelector from './VehicleSelector';
import apiClient from '@/lib/api';

// Mock apiClient
jest.mock('@/lib/api', () => ({
  get: jest.fn(),
}));

// Mock VehicleSelectorSkeleton
jest.mock('@/components/skeletons/VehicleSelectorSkeleton', () => ({
  VehicleSelectorSkeleton: () => <div data-testid="vehicle-skeleton">Loading...</div>,
}));

describe('VehicleSelector Component', () => {
  const mockOnVehicleSelect = jest.fn();
  const mockMakes = { makes: ['Toyota', 'Honda', 'Ford'] };
  const mockModelsToyota = { models: ['Camry', 'Corolla', 'RAV4'] };

  beforeEach(() => {
    jest.clearAllMocks();
    (apiClient.get as jest.Mock).mockImplementation((url) => {
      if (url === '/vehicles/makes') return Promise.resolve(mockMakes);
      if (url === '/vehicles/models/Toyota') return Promise.resolve(mockModelsToyota);
      return Promise.resolve({ models: [] });
    });
  });

  it('renders loading skeleton initially', () => {
    // Delay resolution to check loading state
    (apiClient.get as jest.Mock).mockReturnValue(new Promise(() => {}));
    render(<VehicleSelector onVehicleSelect={mockOnVehicleSelect} />);
    expect(screen.getByTestId('vehicle-skeleton')).toBeInTheDocument();
  });

  it('fetches and renders makes on mount', async () => {
    render(<VehicleSelector onVehicleSelect={mockOnVehicleSelect} />);

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: /make/i })).toBeInTheDocument();
    });

    const makeSelect = screen.getByRole('combobox', { name: /make/i });
    expect(makeSelect).toBeInTheDocument();
    
    // Check options (Toyota, Honda, Ford)
    // Note: The component maps makes to objects with _id, name, slug. 
    // Usually select options render the name.
    expect(screen.getByRole('option', { name: 'Toyota' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Honda' })).toBeInTheDocument();
  });

  it('fetches models when a make is selected', async () => {
    render(<VehicleSelector onVehicleSelect={mockOnVehicleSelect} />);

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: /make/i })).toBeInTheDocument();
    });

    const makeSelect = screen.getByRole('combobox', { name: /make/i });
    fireEvent.change(makeSelect, { target: { value: 'Toyota' } });

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith('/vehicles/models/Toyota');
    });

    const modelSelect = screen.getByRole('combobox', { name: /model/i });
    // Model select should be enabled after make selection
    expect(modelSelect).not.toBeDisabled();
    
    // Wait for models to populate
    await waitFor(() => {
        expect(screen.getByRole('option', { name: 'Camry' })).toBeInTheDocument();
    });
  });

  it('calls onVehicleSelect when both make and model are selected', async () => {
    render(<VehicleSelector onVehicleSelect={mockOnVehicleSelect} />);

    // Select Make
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: /make/i })).toBeInTheDocument();
    });
    fireEvent.change(screen.getByRole('combobox', { name: /make/i }), { target: { value: 'Toyota' } });

    // Select Model
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: /model/i })).not.toBeDisabled();
      expect(screen.getByRole('option', { name: 'Camry' })).toBeInTheDocument();
    });
    
    fireEvent.change(screen.getByRole('combobox', { name: /model/i }), { target: { value: 'Camry' } });

    expect(mockOnVehicleSelect).toHaveBeenCalledWith('Toyota', 'Camry');
  });

  it('handles API errors gracefully', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    (apiClient.get as jest.Mock).mockRejectedValue(new Error('API Error'));

    render(<VehicleSelector onVehicleSelect={mockOnVehicleSelect} />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load vehicle makes')).toBeInTheDocument();
    });
    
    consoleSpy.mockRestore();
  });
});
