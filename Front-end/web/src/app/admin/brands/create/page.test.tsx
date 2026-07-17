import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CreateBrandPage from './page';
import { useRouter } from 'next/navigation';

// The form now submits multipart/form-data via raw fetch (so the logo file can
// be uploaded to Cloudinary), not apiClient JSON. We mock global.fetch.
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));
jest.mock('@/lib/revalidateHome', () => ({ revalidateHome: jest.fn() }));
jest.mock('lucide-react', () => ({
  ArrowLeft: () => <span data-testid="icon-arrow-left">ArrowLeft</span>,
  Save: () => <span data-testid="icon-save">Save</span>,
  Loader2: () => <span data-testid="icon-loader">Loader</span>,
  // Icons used by the embedded <SeoPanel> and <ImageUploader>.
  Search: () => <span data-testid="icon-search">Search</span>,
  ChevronDown: () => <span data-testid="icon-chevron-down">ChevronDown</span>,
  ChevronRight: () => <span data-testid="icon-chevron-right">ChevronRight</span>,
  Info: () => <span data-testid="icon-info">Info</span>,
  Upload: () => <span data-testid="icon-upload">Upload</span>,
  X: () => <span data-testid="icon-x">X</span>,
  ImageIcon: () => <span data-testid="icon-image">ImageIcon</span>,
}));

const okJson = (body: unknown = { success: true }) =>
  Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(body)) } as Response);

describe('CreateBrandPage', () => {
  const mockRouter = { back: jest.fn(), push: jest.fn(), refresh: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
    global.fetch = jest.fn(() => okJson()) as jest.Mock;
    window.alert = jest.fn();
  });

  it('renders form elements', () => {
    render(<CreateBrandPage />);
    expect(screen.getByLabelText(/Brand Name/i)).toBeInTheDocument();
    expect(screen.getByText(/^Logo$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Description/i)).toBeInTheDocument();
  });

  it('generates a slug preview from the name', () => {
    render(<CreateBrandPage />);
    fireEvent.change(screen.getByLabelText(/Brand Name/i), { target: { value: 'Test Brand 123' } });
    expect(screen.getByText('test-brand-123')).toBeInTheDocument();
  });

  it('submits form as multipart to /api/v1/brands', async () => {
    render(<CreateBrandPage />);

    fireEvent.change(screen.getByLabelText(/Brand Name/i), { target: { value: 'New Brand' } });
    fireEvent.change(screen.getByLabelText(/Description/i), { target: { value: 'Desc' } });
    fireEvent.click(screen.getByRole('button', { name: /Create Brand/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('/api/v1/brands');
    expect(opts.method).toBe('POST');
    expect(opts.body).toBeInstanceOf(FormData);
    const fd = opts.body as FormData;
    expect(fd.get('name')).toBe('New Brand');
    expect(fd.get('description')).toBe('Desc');
    expect(fd.get('seo')).toBeTruthy();

    expect(window.alert).toHaveBeenCalledWith('Brand created successfully!');
    expect(mockRouter.push).toHaveBeenCalledWith('/admin/brands');
  });

  it('surfaces a server error message', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: false,
        status: 400,
        text: () => Promise.resolve(JSON.stringify({ message: 'Creation failed' })),
      } as Response),
    ) as jest.Mock;

    render(<CreateBrandPage />);
    fireEvent.change(screen.getByLabelText(/Brand Name/i), { target: { value: 'Fail Brand' } });
    fireEvent.click(screen.getByRole('button', { name: /Create Brand/i }));

    await waitFor(() => expect(screen.getByText('Creation failed')).toBeInTheDocument());
  });

  it('validates required fields', async () => {
    render(<CreateBrandPage />);

    const form = screen.getByRole('button', { name: /Create Brand/i }).closest('form');
    if (!form) throw new Error('Form not found');
    fireEvent.submit(form);

    await waitFor(() => expect(screen.getByText('Brand name is required')).toBeInTheDocument());
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
