import React, { Suspense } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EditVehiclePage from './page';
import apiClient from '@/lib/api';
import { useRouter } from 'next/navigation';

// GET (load) still uses apiClient; the update now submits multipart via fetch.
jest.mock('@/lib/api');
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));
jest.mock('lucide-react', () => ({
  ArrowLeft: () => <span data-testid="icon-arrow-left">ArrowLeft</span>,
  Loader2: () => <span data-testid="icon-loader">Loader2</span>,
  // Icons used by <ImageUploader>.
  Upload: () => <span data-testid="icon-upload">Upload</span>,
  X: () => <span data-testid="icon-x">X</span>,
  ImageIcon: () => <span data-testid="icon-image">ImageIcon</span>,
}));

const renderWithSuspense = (ui: React.ReactNode) =>
  render(<Suspense fallback={<div>Loading Params...</div>}>{ui}</Suspense>);

const okJson = (body: unknown = { success: true }) =>
  Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(body)) } as Response);

describe('EditVehiclePage', () => {
  const mockRouter = { push: jest.fn(), back: jest.fn() };

  const mockVehicle = {
    _id: 'v1',
    make: 'Toyota',
    model: 'Camry',
    slug: 'toyota-camry',
    image: { url: 'http://example.com/camry.jpg', alt: 'Toyota Camry SE' },
    isActive: true,
  };

  const mockParams = Promise.resolve({ id: 'v1' });

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
    (apiClient.get as jest.Mock).mockResolvedValue({ success: true, vehicle: mockVehicle });
    global.fetch = jest.fn(() => okJson()) as jest.Mock;
    window.alert = jest.fn();
    window.confirm = jest.fn().mockReturnValue(true);
  });

  it('renders initial loading state', () => {
    renderWithSuspense(<EditVehiclePage params={mockParams} />);
    expect(screen.getByText('Loading Params...')).toBeInTheDocument();
  });

  it('fetches and populates vehicle data', async () => {
    renderWithSuspense(<EditVehiclePage params={mockParams} />);

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith('/vehicles/v1');
      expect(screen.getByLabelText(/Make/i)).toHaveValue('Toyota');
      expect(screen.getByLabelText(/Model/i)).toHaveValue('Camry');
      expect(screen.getByLabelText(/Slug/i)).toHaveValue('toyota-camry');
    });

    // Current image is shown as a preview (not a URL input anymore).
    expect(screen.getByAltText('Toyota Camry SE')).toHaveAttribute('src', 'http://example.com/camry.jpg');
    expect(screen.getByLabelText(/Image Alt Text/i)).toHaveValue('Toyota Camry SE');
  });

  it('updates vehicle via multipart PUT', async () => {
    renderWithSuspense(<EditVehiclePage params={mockParams} />);

    await waitFor(() => expect(screen.getByLabelText(/Make/i)).toHaveValue('Toyota'));

    fireEvent.change(screen.getByLabelText(/Model/i), { target: { value: 'Corolla' } });

    const form = screen.getByRole('button', { name: /Update Vehicle/i }).closest('form');
    if (!form) throw new Error('Form not found');
    fireEvent.submit(form);

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('/api/v1/vehicles/v1');
    expect(opts.method).toBe('PUT');
    expect(opts.body).toBeInstanceOf(FormData);
    const fd = opts.body as FormData;
    expect(fd.get('make')).toBe('Toyota');
    expect(fd.get('model')).toBe('Corolla');
    expect(fd.get('slug')).toBe('toyota-corolla');

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

    await waitFor(() => expect(screen.getByLabelText(/Make/i)).toHaveValue('Toyota'));

    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        text: () => Promise.resolve(JSON.stringify({ message: 'Update failed' })),
      } as Response),
    ) as jest.Mock;

    const form = screen.getByRole('button', { name: /Update Vehicle/i }).closest('form');
    if (!form) throw new Error('Form not found');
    fireEvent.submit(form);

    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Update failed'));
  });
});
