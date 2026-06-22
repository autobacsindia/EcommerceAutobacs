'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Upload, CheckCircle, AlertTriangle } from 'lucide-react';

interface ImportError { line: number; name: string; reason: string; }
interface ImportResults { total: number; created: number; failed: number; errors: ImportError[]; }

const TEMPLATE_HEADER = 'name,description,shortDescription,price,originalPrice,category,brand,stock,sku,tags';
const TEMPLATE_SAMPLE = 'LED Headlight,High-output LED headlight for night driving,Bright LED headlight,4999,5999,Headlight|Lighting,Auxbeam,in,LED-HL-01,led|headlight';

export default function BulkImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<ImportResults | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) { setError('Please choose a CSV file first.'); return; }
    setError(null);
    setResults(null);
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('file', file);

      const token = document.cookie.match(/(?:^|;\s*)token=([^;]*)/)?.[1] ?? '';
      const csrfToken = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]*)/)?.[1] ?? '';

      const res = await fetch('/api/v1/products/import/csv', {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(csrfToken ? { 'X-XSRF-TOKEN': decodeURIComponent(csrfToken) } : {}),
        },
        credentials: 'include',
        body: fd,
      });
      const data = await res.json();
      if (!res.ok && !data.results) throw new Error(data.message || 'Import failed');
      setResults(data.results);
    } catch (err: any) {
      setError(err?.message || 'Import failed');
    } finally {
      setSubmitting(false);
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob([`${TEMPLATE_HEADER}\n${TEMPLATE_SAMPLE}\n`], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'product-import-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 max-w-3xl">
      <Link href="/admin/products" className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4">
        <ArrowLeft className="h-4 w-4 mr-1" /> Back to products
      </Link>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Bulk import products</h1>
      <p className="text-gray-600 mb-6">
        Upload a CSV to create many products at once. Each row needs at least a name,
        a description (10+ chars), a price, and a valid category. Categories are matched by
        name or slug; separate multiple with <code className="bg-gray-100 px-1">|</code>.
      </p>

      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">CSV columns</h2>
          <button onClick={downloadTemplate} className="text-sm text-blue-600 hover:underline">Download template</button>
        </div>
        <code className="block bg-gray-50 border border-gray-200 rounded p-3 text-xs text-gray-700 mb-6 overflow-x-auto">
          {TEMPLATE_HEADER}
        </code>

        <form onSubmit={handleSubmit}>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResults(null); setError(null); }}
            className="block w-full text-sm text-gray-700 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 mb-4"
          />
          <button
            type="submit"
            disabled={submitting || !file}
            className="inline-flex items-center bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            <Upload className="h-4 w-4 mr-2" />
            {submitting ? 'Importing…' : 'Import CSV'}
          </button>
        </form>

        {error && (
          <div className="mt-4 bg-red-50 border border-red-200 rounded p-3 text-red-700 text-sm">{error}</div>
        )}

        {results && (
          <div className="mt-6">
            <div className="flex items-center gap-4 mb-3">
              <span className="inline-flex items-center text-green-700">
                <CheckCircle className="h-5 w-5 mr-1" /> {results.created} created
              </span>
              {results.failed > 0 && (
                <span className="inline-flex items-center text-amber-700">
                  <AlertTriangle className="h-5 w-5 mr-1" /> {results.failed} failed
                </span>
              )}
              <span className="text-gray-500">of {results.total} rows</span>
            </div>
            {results.errors.length > 0 && (
              <div className="border border-gray-200 rounded overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="text-left px-3 py-2 w-16">Row</th>
                      <th className="text-left px-3 py-2">Name</th>
                      <th className="text-left px-3 py-2">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {results.errors.map((err, idx) => (
                      <tr key={idx}>
                        <td className="px-3 py-2 text-gray-500">{err.line}</td>
                        <td className="px-3 py-2">{err.name || <span className="text-gray-400">—</span>}</td>
                        <td className="px-3 py-2 text-red-600">{err.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
