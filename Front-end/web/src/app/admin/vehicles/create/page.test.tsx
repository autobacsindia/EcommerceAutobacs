import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CreateVehiclePage from './page';
import { useRouter } from 'next/navigation';

// The form now submits multipart/form-data via raw fetch (so the image file can
// be uploaded to Cloudinary), not apiClient JSON. We mock global.fetch.
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

const okJson = (body: unknown = { success: true }) =>
  Promise.resolve({ ok: true, status: 201, text: () => Promise.resolve(JSON.stringify(body)) } as Response);
const failJson = (message: string, status = 400) =>
  Promise.resolve({ ok: false, status, text: () => Promise.resolve(JSON.stringify({ message })) } as Response);

describe('CreateVehiclePage', () => {
  const mockRouter = { push: jest.fn(), back: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
    global.fetch = jest.fn(() => okJson()) as jest.Mock;
    window.alert = jest.fn();
  });

  it('renders create vehicle form correctly', () => {
    render(<CreateVehiclePage />);

    expect(screen.getByText('Add New Vehicle')).toBeInTheDocument();
    expect(screen.getByLabelText(/Make/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Model/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Slug/i)).toBeInTheDocument();
    expect(screen.getByText(/Vehicle Image/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Image Alt Text/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Active/i)).toBeChecked();
  });

  it('validates required fields', async () => {
    render(<CreateVehiclePage />);

    const form = screen.getByRole('button', { name: /Create Vehicle/i }).closest('form');
    if (!form) throw new Error('Form not found');
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText('Make is required')).toBeInTheDocument();
      expect(screen.getByText('Model is required')).toBeInTheDocument();
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('auto-generates slug from make and model', () => {
    render(<CreateVehiclePage />);
    fireEvent.change(screen.getByLabelText(/Make/i), { target: { value: 'Toyota' } });
    fireEvent.change(screen.getByLabelText(/Model/i), { target: { value: 'Camry' } });
    expect(screen.getByLabelText(/Slug/i)).toHaveValue('toyota-camry');
  });

  it('submits form as multipart to /api/v1/vehicles', async () => {
    render(<CreateVehiclePage />);

    fireEvent.change(screen.getByLabelText(/Make/i), { target: { value: 'Toyota' } });
    fireEvent.change(screen.getByLabelText(/Model/i), { target: { value: 'Camry' } });

    const form = screen.getByRole('button', { name: /Create Vehicle/i }).closest('form');
    if (!form) throw new Error('Form not found');
    fireEvent.submit(form);

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('/api/v1/vehicles');
    expect(opts.method).toBe('POST');
    expect(opts.body).toBeInstanceOf(FormData);
    const fd = opts.body as FormData;
    expect(fd.get('make')).toBe('Toyota');
    expect(fd.get('model')).toBe('Camry');
    expect(fd.get('slug')).toBe('toyota-camry');

    expect(window.alert).toHaveBeenCalledWith('Vehicle created successfully!');
    expect(mockRouter.push).toHaveBeenCalledWith('/admin/vehicles');
  });

  it('handles duplicate slug error', async () => {
    global.fetch = jest.fn(() => failJson('duplicate key error')) as jest.Mock;
    render(<CreateVehiclePage />);

    fireEvent.change(screen.getByLabelText(/Make/i), { target: { value: 'Toyota' } });
    fireEvent.change(screen.getByLabelText(/Model/i), { target: { value: 'Camry' } });

    const form = screen.getByRole('button', { name: /Create Vehicle/i }).closest('form');
    if (!form) throw new Error('Form not found');
    fireEvent.submit(form);

    await waitFor(() => expect(screen.getByText(/This slug is already in use/i)).toBeInTheDocument());
  });

  it('handles general API error', async () => {
    global.fetch = jest.fn(() => failJson('Server exploded')) as jest.Mock;
    render(<CreateVehiclePage />);

    fireEvent.change(screen.getByLabelText(/Make/i), { target: { value: 'Toyota' } });
    fireEvent.change(screen.getByLabelText(/Model/i), { target: { value: 'Camry' } });

    const form = screen.getByRole('button', { name: /Create Vehicle/i }).closest('form');
    if (!form) throw new Error('Form not found');
    fireEvent.submit(form);

    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Server exploded'));
  });
});
