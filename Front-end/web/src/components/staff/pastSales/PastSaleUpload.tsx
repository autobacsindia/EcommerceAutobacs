'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Loader2, Upload } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { postForm } from '@/components/payments/api';
import { pastSaleKeys } from '@/hooks/queries/keys';
import { errorMessage, rupees } from '@/components/staff/sales/types';
import { TEMPLATE_HREF, type PastSaleSeller, type UploadResult, type UploadStatus, type Viewer } from './types';

const BADGE: Record<UploadStatus, { text: string; tone: string }> = {
  ready: { text: 'Ready', tone: 'bg-green-100 text-green-800' },
  imported: { text: 'Added', tone: 'bg-green-100 text-green-800' },
  duplicate: { text: 'Already entered', tone: 'bg-gray-200 text-gray-700' },
  error: { text: 'Needs fixing', tone: 'bg-red-100 text-red-800' },
};

function ResultTable({ result }: { result: UploadResult }) {
  // Problems first: they are what the salesman has to act on.
  const order: Record<UploadStatus, number> = { error: 0, duplicate: 1, ready: 2, imported: 2 };
  const rows = [...result.sales].sort((a, b) => order[a.status] - order[b.status] || a.rows[0] - b.rows[0]);
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs font-medium text-gray-500">
          <tr>
            <th className="px-3 py-2">Row</th>
            <th className="px-3 py-2">Sale</th>
            <th className="px-3 py-2 text-right">Total</th>
            <th className="px-3 py-2">Result</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((s) => (
            <tr key={s.rows.join(',')} className="align-top">
              <td className="whitespace-nowrap px-3 py-2 text-gray-500">{s.rows.length > 1 ? `${s.rows[0]}–${s.rows[s.rows.length - 1]}` : s.rows[0]}</td>
              <td className="px-3 py-2">
                <p className="font-medium text-gray-900">{s.customer || '—'}</p>
                <p className="text-xs text-gray-500">{s.saleDate}{s.invoiceNo ? ` · Bill ${s.invoiceNo}` : ''} · {s.items} item{s.items === 1 ? '' : 's'}</p>
                {[...s.reasons, ...s.warnings].map((r) => (
                  <p key={r} className={`mt-1 text-xs ${s.status === 'error' ? 'text-red-700' : 'text-amber-700'}`}>{r}</p>
                ))}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right">{s.totalAmount != null ? rupees(s.totalAmount) : '—'}</td>
              <td className="px-3 py-2">
                <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[s.status].tone}`}>{BADGE[s.status].text}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Upload many past sales from a sheet. Two steps: "Check file" shows what will
 * happen to every sale and saves nothing; "Add N sales" then saves only the ready
 * ones. Uploading the same file again adds nothing — those show as already entered.
 */
export default function PastSaleUpload({ viewer, onClose }: { viewer: Viewer; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [salesUserId, setSalesUserId] = useState('none');
  const [preview, setPreview] = useState<UploadResult | null>(null);
  const [done, setDone] = useState<UploadResult | null>(null);
  const [busy, setBusy] = useState<'' | 'check' | 'import' | 'undo'>('');
  const [error, setError] = useState('');
  const [undone, setUndone] = useState<number | null>(null);

  const sellers = useQuery({
    queryKey: pastSaleKeys.sellers(),
    queryFn: () => apiClient.get<{ sellers: PastSaleSeller[] }>('/staff/past-sales/sellers'),
    enabled: viewer.manage,
    staleTime: 5 * 60_000,
  });

  const formFor = () => {
    const form = new FormData();
    if (file) form.append('file', file);
    if (viewer.manage) form.append('salesUserId', salesUserId);
    return form;
  };

  async function check() {
    if (!file) { setError('Choose the CSV file first.'); return; }
    setBusy('check'); setError(''); setPreview(null); setDone(null); setUndone(null);
    try {
      setPreview(await postForm<UploadResult>('/staff/past-sales/upload/preview', formFor()));
    } catch (e) {
      setError(errorMessage(e, 'Could not read the file.'));
    } finally {
      setBusy('');
    }
  }

  async function runImport() {
    setBusy('import'); setError('');
    try {
      const res = await postForm<UploadResult>('/staff/past-sales/upload', formFor());
      setDone(res);
      setPreview(null);
      queryClient.invalidateQueries({ queryKey: pastSaleKeys.all });
    } catch (e) {
      setError(errorMessage(e, 'Could not add the sales. Nothing was saved twice — you can try again.'));
    } finally {
      setBusy('');
    }
  }

  async function undo() {
    if (!done?.batchId) return;
    if (!window.confirm(`Undo this upload? The ${done.counts.imported} sales it added will be deleted (they can be restored one by one).`)) return;
    setBusy('undo'); setError('');
    try {
      const res = await apiClient.delete<{ deleted: number }>(`/staff/past-sales/uploads/${encodeURIComponent(done.batchId)}`);
      setUndone(res.deleted);
      queryClient.invalidateQueries({ queryKey: pastSaleKeys.all });
    } catch (e) {
      setError(errorMessage(e, 'Could not undo the upload.'));
    } finally {
      setBusy('');
    }
  }

  return (
    <section aria-label="Upload past sales" className="space-y-4 rounded-xl border border-blue-200 bg-blue-50/30 p-4 sm:p-5">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Upload a sheet of past sales</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-gray-600">
          <li>Download the template and fill it in Excel: <strong>one row per item</strong>. Rows with the same bill number become one sale.</li>
          <li>In Excel, choose File → Save As → <strong>CSV UTF-8</strong>.</li>
          <li>Upload it and press <strong>Check file</strong>. Nothing is saved until you press Add.</li>
        </ol>
        <a href={TEMPLATE_HREF} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50">
          <Download className="h-4 w-4" /> Download template
        </a>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-gray-700">CSV file</span>
          <input type="file" accept=".csv,text/csv"
            onChange={(e) => { setFile(e.target.files?.[0] || null); setPreview(null); setDone(null); setError(''); }}
            className="block text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-gray-900 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white" />
        </label>
        {viewer.manage && (
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-gray-700">Sold by (every sale in the file)</span>
            <select value={salesUserId} onChange={(e) => { setSalesUserId(e.target.value); setPreview(null); }} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="none">No salesman</option>
              {(sellers.data?.sellers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}{s.current ? '' : ' (former)'}</option>)}
            </select>
          </label>
        )}
        <button type="button" onClick={check} disabled={!file || !!busy}
          className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50">
          {busy === 'check' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Check file
        </button>
      </div>

      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {preview && (
        <div className="space-y-3">
          <p className="text-sm text-gray-800">
            {preview.counts.rows} rows → {preview.counts.sales} sales: <strong>{preview.counts.ready} ready</strong>
            {preview.counts.ready ? ` (${rupees(preview.readyValue || 0)})` : ''}, {preview.counts.duplicates} already entered, {preview.counts.errors} need fixing.
          </p>
          <ResultTable result={preview} />
          {preview.counts.errors > 0 && (
            <p className="text-sm text-gray-600">Sales that need fixing are skipped. Fix them in the sheet and upload it again later — what you add now will show as &ldquo;already entered&rdquo;.</p>
          )}
          <button type="button" onClick={runImport} disabled={!preview.counts.ready || !!busy}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
            {busy === 'import' && <Loader2 className="h-4 w-4 animate-spin" />} Add {preview.counts.ready} sale{preview.counts.ready === 1 ? '' : 's'}
          </button>
        </div>
      )}

      {done && (
        <div className="space-y-3">
          <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">
            Added {done.counts.imported} sale{done.counts.imported === 1 ? '' : 's'}{done.counts.imported ? ` (${rupees(done.importedValue || 0)})` : ''}.
            {done.counts.duplicates ? ` ${done.counts.duplicates} were already entered.` : ''}
            {done.counts.errors ? ` ${done.counts.errors} need fixing.` : ''}
          </p>
          <ResultTable result={done} />
          {viewer.manage && done.batchId && undone === null && (
            <button type="button" onClick={undo} disabled={!!busy}
              className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">
              Undo this upload
            </button>
          )}
          {undone !== null && <p className="text-sm text-gray-600">Upload undone: {undone} sales deleted.</p>}
        </div>
      )}

      <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
        Close
      </button>
    </section>
  );
}
