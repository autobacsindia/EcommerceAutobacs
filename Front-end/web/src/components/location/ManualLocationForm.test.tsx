import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ManualLocationForm from './ManualLocationForm';
import { useLocation } from '@/context/LocationContext';
import toast from 'react-hot-toast';

// Mock LocationContext
jest.mock('@/context/LocationContext', () => ({
  useLocation: jest.fn(),
}));

// Mock toast
jest.mock('react-hot-toast', () => {
  const mockToast = {
    success: jest.fn(),
    error: jest.fn(),
  };
  return {
    __esModule: true,
    default: mockToast,
    toast: mockToast,
  };
});

describe('ManualLocationForm Component', () => {
  const mockSelectLocation = jest.fn();
  const mockOnClose = jest.fn();
  const mockOnLocationSelected = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useLocation as jest.Mock).mockReturnValue({
      selectLocation: mockSelectLocation,
      isLoading: false,
    });
  });

  it('renders nothing when not open', () => {
    render(
      <ManualLocationForm 
        isOpen={false} 
        onClose={mockOnClose} 
      />
    );
    expect(screen.queryByText(/Enter Location Details/i)).not.toBeInTheDocument();
  });

  it('renders correctly when open', () => {
    render(
      <ManualLocationForm 
        isOpen={true} 
        onClose={mockOnClose} 
      />
    );
    
    // Check for inputs
    expect(screen.getByPlaceholderText(/City/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/State/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Postal Code/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue('India')).toBeInTheDocument(); // Country is defaulted
    
    // Check buttons
    expect(screen.getByRole('button', { name: /Save Location/i })).toBeInTheDocument();
  });

  it('validates empty fields', () => {
    render(
      <ManualLocationForm 
        isOpen={true} 
        onClose={mockOnClose} 
      />
    );
    
    const saveButton = screen.getByRole('button', { name: /Save Location/i });
    // Use fireEvent.submit to bypass HTML5 validation blocking which might happen with click
    fireEvent.submit(saveButton.closest('form')!);
    
    expect(toast.error).toHaveBeenCalledWith('Please enter a city');
    expect(mockSelectLocation).not.toHaveBeenCalled();
  });

  it('validates postal code format', () => {
    render(
      <ManualLocationForm 
        isOpen={true} 
        onClose={mockOnClose} 
      />
    );
    
    // Fill city and state
    fireEvent.change(screen.getByPlaceholderText(/City/i), { target: { value: 'Mumbai' } });
    fireEvent.change(screen.getByPlaceholderText(/State/i), { target: { value: 'Maharashtra' } });
    
    // Invalid postal code
    fireEvent.change(screen.getByPlaceholderText(/Postal Code/i), { target: { value: '123' } });
    
    const saveButton = screen.getByRole('button', { name: /Save Location/i });
    fireEvent.click(saveButton);
    
    expect(toast.error).toHaveBeenCalledWith('Please enter a valid 6-digit postal code');
    expect(mockSelectLocation).not.toHaveBeenCalled();
  });

  it('submits valid data', async () => {
    mockSelectLocation.mockResolvedValueOnce({});
    
    render(
      <ManualLocationForm 
        isOpen={true} 
        onClose={mockOnClose}
        onLocationSelected={mockOnLocationSelected}
      />
    );
    
    // Fill form
    fireEvent.change(screen.getByPlaceholderText(/City/i), { target: { value: 'Mumbai' } });
    fireEvent.change(screen.getByPlaceholderText(/State/i), { target: { value: 'Maharashtra' } });
    fireEvent.change(screen.getByPlaceholderText(/Postal Code/i), { target: { value: '400001' } });
    
    const saveButton = screen.getByRole('button', { name: /Save Location/i });
    fireEvent.click(saveButton);
    
    await waitFor(() => {
      expect(mockSelectLocation).toHaveBeenCalledWith({
        address: {
          city: 'Mumbai',
          state: 'Maharashtra',
          postalCode: '400001',
          country: 'India',
        }
      });
      expect(toast.success).toHaveBeenCalledWith('Location saved successfully!');
      expect(mockOnLocationSelected).toHaveBeenCalled();
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  it('handles submission error', async () => {
    const errorMsg = 'Invalid location';
    mockSelectLocation.mockRejectedValueOnce(new Error(errorMsg));
    
    render(
      <ManualLocationForm 
        isOpen={true} 
        onClose={mockOnClose} 
      />
    );
    
    // Fill form
    fireEvent.change(screen.getByPlaceholderText(/City/i), { target: { value: 'Mumbai' } });
    fireEvent.change(screen.getByPlaceholderText(/State/i), { target: { value: 'Maharashtra' } });
    fireEvent.change(screen.getByPlaceholderText(/Postal Code/i), { target: { value: '400001' } });
    
    const saveButton = screen.getByRole('button', { name: /Save Location/i });
    fireEvent.click(saveButton);
    
    await waitFor(() => {
      expect(mockSelectLocation).toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith(errorMsg);
      expect(mockOnClose).not.toHaveBeenCalled();
    });
  });
});
