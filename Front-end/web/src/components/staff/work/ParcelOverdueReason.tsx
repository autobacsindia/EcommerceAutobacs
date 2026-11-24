'use client';

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { History, MessageSquareWarning, Paperclip, X } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { tokenManager } from '@/lib/http/tokenManager';
import { staffKeys } from '@/hooks/queries/keys';
import { formatDateTimeIST } from '@/lib/datetime';
import { errorMessage } from '@/components/staff/sales/types';
import { formatEtaDay } from './ParcelEta';
import type { OverdueReasonCode, OverdueReasonFile, WorkOrder } from './types';

/*
  Reason for overdue on a parcel past its expected delivery date (Back-end
  teamWorkflowService.setParcelOverdueReason). Procurement, operations and the admin give
  it; everyone who sees the parcel reads it. The server decides who may, checks
  the parcel is still overdue on the date shown, and keeps every reason given.

  One optional file (photo, screenshot of the courier page, PDF) may go with a
  reason. The server checks it by its bytes; if it cannot be stored, nothing is
  saved and the person chooses "Save without file" — a reason is never silently
  saved without the file they attached. Each save carries a requestId, so a
  double-click or a retry adds one entry.
*/

/** Same list and limit as the server (utils/parcelEta.js). */
export const OVERDUE_REASONS: { value: OverdueReasonCode; label: string }[] = [
  { value: 'supplier_delay', label: 'Supplier delay' },
  { value: 'courier_delay', label: 'Courier delay' },
  { value: 'customer_unreachable', label: 'Customer unreachable' },
  { value: 'address_issue', label: 'Address issue' },
  { value: 'other', label: 'Other' },
];
export const MAX_OVERDUE_NOTE = 300;
/** Same as the server (config/attachments.js MAX_ATTACHMENT_BYTES; storage/attachmentCheck.js types). */
export const MAX_OVERDUE_FILE_BYTES = 10 * 1024 * 1024;
export const OVERDUE_FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const FILE_ACCEPT = '.jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf';

/** Why a picked file can't go, before it is sent (the server checks again, by the bytes). */
export function overdueFileProblem(f: File): string {
  const ext = f.name.toLowerCase().split('.').pop() || '';
  const typeOk = OVERDUE_FILE_TYPES.includes(f.type) || (!f.type && ['jpg', 'jpeg', 'png', 'webp', 'pdf'].includes(ext));
  if (!typeOk) return `"${f.name}" is not a photo (JPG, PNG, WebP) or a PDF.`;
  if (f.size > MAX_OVERDUE_FILE_BYTES) return `"${f.name}" is too large (10 MB maximum).`;
  return '';
}

const newRequestId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
const sizeText = (b: number) => (b >= 1024 * 1024 ? `${(b / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Multipart PUT (the JSON client can't send files), with the same CSRF header it uses. */
async function putForm<T>(endpoint: string, form: FormData): Promise<T> {
  await tokenManager.ensureCsrfToken();
  const headers = tokenManager.getHeaders() as Record<string, string>;
  delete headers['Content-Type']; // the browser sets the multipart boundary
  const res = await fetch(`/api/v1${endpoint}`, { method: 'PUT', body: form, headers, credentials: 'include' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body?.message || 'Upload failed'), { rawData: body });
  return body as T;
}

/** The file on a reason: opens through the staff-only file route, in a new tab. */
export function OverdueFileChip({ file }: { file: OverdueReasonFile }) {
  return (
    <a href={file.url} target="_blank" rel="noopener noreferrer"
      className="inline-flex max-w-[14rem] items-center gap-1 rounded-full border border-gray-300 bg-gray-50 px-2 py-0.5 text-xs text-blue-700 hover:bg-gray-100"
      title={`${file.name} (${sizeText(file.size)})`} aria-label={`Open file ${file.name}`}>
      <Paperclip className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate">{file.name}</span>
    </a>
  );
}

type Parcel = WorkOrder['parcels'][number];
const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50';
const field = 'rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';

export default function ParcelOverdueReason({ orderId, parcel }: { orderId: string; parcel: Parcel }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState<OverdueReasonCode | ''>('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  // A save that carried a file failed: offer to save the reason on its own (never silently).
  const [fileFailed, setFileFailed] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // One id per save attempt; a new one whenever what would be saved changes.
  const requestId = useRef(newRequestId());
  const fileInput = useRef<HTMLInputElement>(null);
  // A second click lands before React re-renders the button disabled.
  const inFlight = useRef(false);
  const changed = () => { requestId.current = newRequestId(); setFileFailed(false); };

  const save = useMutation({
    mutationFn: ({ withFile }: { withFile: boolean }) => {
      const endpoint = `/staff/work/orders/${orderId}/parcels/${parcel.id}/overdue-reason`;
      if (!withFile || !file) {
        return apiClient.put<{ order: WorkOrder }>(endpoint, {
          code, note: note.trim(), expectedDate: parcel.eta?.date ?? null, requestId: requestId.current,
        });
      }
      const form = new FormData();
      form.append('code', code);
      form.append('note', note.trim());
      if (parcel.eta?.date) form.append('expectedDate', parcel.eta.date);
      form.append('requestId', requestId.current);
      form.append('file', file);
      return putForm<{ order: WorkOrder }>(endpoint, form);
    },
    onSuccess: (res) => {
      setError('');
      setFileFailed(false);
      setFile(null);
      requestId.current = newRequestId();
      setEditing(false);
      const self = staffKeys.workOrder(orderId);
      queryClient.setQueryData(self, res);
      // The lists carry the "no reason" count; this order's own reply is already fresh.
      queryClient.invalidateQueries({
        queryKey: staffKeys.orders(),
        predicate: (query) => JSON.stringify(query.queryKey) !== JSON.stringify(self),
      });
    },
    onSettled: () => { inFlight.current = false; },
    onError: (e, { withFile }) => {
      setError(errorMessage(e, withFile ? 'The file could not be uploaded, so the reason was not saved.' : 'Could not save the reason.'));
      setFileFailed(withFile && !!file);
    },
  });

  const current = parcel.overdueReason ?? null;
  const history = parcel.overdueReasonHistory ?? [];
  const overdue = parcel.etaState === 'overdue';
  // Nothing to show: not overdue and never explained.
  if (!overdue && !history.length) return null;

  const noteNeeded = code === 'other' && !note.trim();
  const open = () => {
    setCode(current?.code ?? '');
    setNote(current?.note ?? '');
    setFile(null);
    setError('');
    changed();
    setEditing(true);
  };
  const pick = (f: File | null) => {
    changed();
    if (fileInput.current) fileInput.current.value = '';
    if (!f) { setFile(null); return; }
    const problem = overdueFileProblem(f);
    setError(problem);
    setFile(problem ? null : f);
  };
  const submit = (withFile: boolean) => {
    if (!code || noteNeeded || inFlight.current) return;
    inFlight.current = true;
    // Same requestId: if the failed save did land after all, this is a no-op, not a second entry.
    if (!withFile && file) { setFile(null); setFileFailed(false); }
    save.mutate({ withFile });
  };

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {overdue && (current ? (
          <span className="text-gray-800">
            <MessageSquareWarning className="mr-1 inline h-3.5 w-3.5 text-red-600" aria-hidden />
            Reason for overdue: <strong>{current.text}</strong>
            <span className="text-gray-500"> · by {current.by || 'Staff'}{current.at ? `, ${formatDateTimeIST(current.at)}` : ''}</span>
            {current.attachment && <> <OverdueFileChip file={current.attachment} /></>}
          </span>
        ) : (
          <span className="font-medium text-red-700">
            <MessageSquareWarning className="mr-1 inline h-3.5 w-3.5" aria-hidden />
            No reason for overdue yet
          </span>
        ))}
        {parcel.canExplainOverdue && !editing && (
          <button type="button" className={`${btn} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`} onClick={open}>
            {current ? 'Change reason' : 'Add reason'}
          </button>
        )}
        {history.length > 0 && (
          <button type="button" className="inline-flex items-center gap-1 text-gray-500 underline-offset-2 hover:underline"
            aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}>
            <History className="h-3 w-3" /> Reasons given ({history.length})
          </button>
        )}
      </div>
      {editing && (
        <form className="flex flex-wrap items-start gap-2" aria-label={`Reason for overdue, parcel ${parcel.sequence}`}
          onSubmit={(e) => { e.preventDefault(); submit(true); }}>
          <select required aria-label="Reason" value={code} className={field}
            onChange={(e) => { changed(); setCode(e.target.value as OverdueReasonCode | ''); }}>
            <option value="">Choose a reason…</option>
            {OVERDUE_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <input type="text" aria-label="Details" maxLength={MAX_OVERDUE_NOTE} value={note} onChange={(e) => { changed(); setNote(e.target.value); }}
            placeholder={code === 'other' ? 'Say what happened (required)' : 'Details (optional), e.g. stuck at the courier hub'}
            className={`${field} min-w-[16rem] flex-1`} />
          {file ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-gray-50 px-2 py-1 text-xs text-gray-800">
              <Paperclip className="h-3 w-3" aria-hidden />
              <span className="max-w-[10rem] truncate" title={file.name}>{file.name}</span>
              <span className="text-gray-500">({sizeText(file.size)})</span>
              <button type="button" aria-label="Remove file" className="rounded-full p-0.5 hover:bg-gray-200" onClick={() => pick(null)}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ) : (
            <label className={`${btn} cursor-pointer border border-dashed border-gray-300 bg-white text-gray-700 hover:bg-gray-50`}>
              <Paperclip className="h-3.5 w-3.5" aria-hidden /> Attach file (optional)
              <input ref={fileInput} type="file" accept={FILE_ACCEPT} className="sr-only" aria-label="Attach a photo or PDF (optional)"
                onChange={(e) => pick(e.target.files?.[0] ?? null)} />
            </label>
          )}
          <button type="submit" disabled={save.isPending || !code || noteNeeded} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>
            {save.isPending ? 'Saving…' : 'Save reason'}
          </button>
          {fileFailed && (
            <button type="button" disabled={save.isPending} className={`${btn} border border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100`}
              onClick={() => submit(false)}>Save without file</button>
          )}
          <button type="button" className={`${btn} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`} onClick={() => setEditing(false)}>Cancel</button>
        </form>
      )}
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      {showHistory && (
        <ol className="space-y-0.5 border-l-2 border-gray-200 pl-2" aria-label={`Reasons given for parcel ${parcel.sequence}`}>
          {history.map((h, i) => (
            <li key={`${h.at}-${i}`} className="text-xs text-gray-600">
              {h.note ? `${h.label} — ${h.note}` : h.label}
              <span className="text-gray-500"> — {h.by || 'Staff'}, {formatDateTimeIST(h.at)}{h.forDate ? ` (was due ${formatEtaDay(h.forDate)})` : ''}</span>
              {h.attachment && <> <OverdueFileChip file={h.attachment} /></>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
