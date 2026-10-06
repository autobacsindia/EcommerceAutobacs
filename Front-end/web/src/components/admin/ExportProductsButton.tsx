'use client';

import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';

const ENDPOINT = '/api/v1/products/admin/export';

/** Server's file name (it carries the IST date), else a sensible default. */
export function fileNameFrom(disposition: string | null): string {
  const match = disposition?.match(/filename="([^"]+)"/);
  return match?.[1] || 'autobacs-products.xlsx';
}

/**
 * Downloads the whole catalogue as an Excel file.
 *
 * Fetched rather than a plain link so a failure (expired session, server error)
 * shows a message here instead of navigating the admin to a raw JSON error page.
 */
export default function ExportProductsButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function exportProducts() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(ENDPOINT, { credentials: 'include', cache: 'no-store' });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { message?: string } | null;
        throw new Error(
          res.status === 401 ? 'Your session has expired. Please sign in again.'
            : body?.message || 'Could not prepare the export. Please try again.',
        );
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileNameFrom(res.headers.get('content-disposition'));
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not prepare the export. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end">
      <button
        type="button"
        onClick={exportProducts}
        disabled={busy}
        className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 flex items-center gap-2 text-sm disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        {busy ? 'Preparing…' : 'Export to Excel'}
      </button>
      {error && <p role="alert" className="mt-1 max-w-xs text-right text-xs text-red-600">{error}</p>}
    </div>
  );
}
