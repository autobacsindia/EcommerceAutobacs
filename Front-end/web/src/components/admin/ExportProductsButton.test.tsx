import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ExportProductsButton, { fileNameFrom } from './ExportProductsButton';

const realFetch = global.fetch;
const click = jest.fn();

beforeEach(() => {
  click.mockReset();
  // jsdom has no object URLs and does not download on click.
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = jest.fn(() => 'blob:x');
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = jest.fn();
  jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    click(this.download, this.href);
  });
});

afterEach(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

const respond = (init: { ok: boolean; status: number; json?: unknown; disposition?: string }) => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: init.ok,
    status: init.status,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-disposition' ? init.disposition ?? null : null) },
    blob: () => Promise.resolve(new Blob(['PK'])),
    json: () => Promise.resolve(init.json ?? {}),
  }) as unknown as typeof fetch;
};

describe('ExportProductsButton', () => {
  it('downloads the file under the name the server gives it', async () => {
    respond({ ok: true, status: 200, disposition: 'attachment; filename="autobacs-products-2026-10-06.xlsx"' });
    render(<ExportProductsButton />);

    fireEvent.click(screen.getByRole('button', { name: /export to excel/i }));

    await waitFor(() => expect(click).toHaveBeenCalledWith('autobacs-products-2026-10-06.xlsx', 'blob:x'));
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/products/admin/export', expect.objectContaining({ credentials: 'include' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('explains an expired session instead of downloading an error page', async () => {
    respond({ ok: false, status: 401, json: { message: 'Not authorized' } });
    render(<ExportProductsButton />);

    fireEvent.click(screen.getByRole('button', { name: /export to excel/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/session has expired/i);
    expect(click).not.toHaveBeenCalled();
  });

  it("shows the server's message for any other failure, and can be retried", async () => {
    respond({ ok: false, status: 500, json: { message: 'Database is busy' } });
    render(<ExportProductsButton />);

    fireEvent.click(screen.getByRole('button', { name: /export to excel/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Database is busy');
    expect(screen.getByRole('button', { name: /export to excel/i })).toBeEnabled();
  });
});

describe('fileNameFrom', () => {
  it('falls back when the server sends no name', () => {
    expect(fileNameFrom(null)).toBe('autobacs-products.xlsx');
    expect(fileNameFrom('attachment')).toBe('autobacs-products.xlsx');
  });
});
