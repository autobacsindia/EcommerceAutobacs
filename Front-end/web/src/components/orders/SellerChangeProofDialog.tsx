'use client';

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Paperclip, X } from 'lucide-react';
import FilePicker from '@/components/payments/FilePicker';
import { MAX_ATTACHMENTS, PROOF_FILES } from '@/lib/attachments';
import { postForm } from '@/lib/postForm';

/** Same as the server's MIN_PROOF_NOTE (services/orderAttributionService.js). */
export const MIN_PROOF_NOTE = 20;
const MAX_NOTE = 1000;
const TYPES = 'photos, PDF, Word, Excel, TXT or CSV';

export type ProofFailure = { message: string };

const newChangeId = () => (typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`);

/**
 * The proof popup for changing who is credited with an order: at least one file,
 * or a written note of MIN_PROOF_NOTE characters. The server enforces the same.
 *
 * Nothing changes until the server confirms. One popup is one `changeId`, so
 * Submit pressed again after a dropped connection cannot make a second change.
 * A clash with someone else's change closes the popup (`onConflict`): this proof
 * was for a change that no longer makes sense. Any other failure stays open to retry.
 */
export default function SellerChangeProofDialog({
  orderId, fromId, fromName, toId, toName, onCancel, onSaved, onConflict,
}: {
  orderId: string;
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
  onConflict: (failure: ProofFailure) => void | Promise<void>;
}) {
  const changeId = useRef(newChangeId());
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const noteLength = note.trim().replace(/\s+/g, ' ').length;
  const hasProof = files.length > 0 || noteLength >= MIN_PROOF_NOTE;

  async function submit() {
    if (!hasProof || busy) return;
    const form = new FormData();
    form.append('salesUserId', toId);
    form.append('expectedSalesUserId', fromId);
    form.append('changeId', changeId.current);
    if (note.trim()) form.append('note', note.trim());
    for (const f of files) form.append('proof', f);
    setBusy(true);
    setError('');
    try {
      await postForm(`/staff/attribution/orders/${encodeURIComponent(orderId)}`, form, 'PUT');
      await onSaved();
    } catch (e) {
      const failure = e as { message?: string; status?: number; rawData?: { message?: string } };
      const message = failure.rawData?.message || 'Could not save. Check your connection and try again.';
      if (failure.status === 409) await onConflict({ message });
      else { setError(message); setBusy(false); }
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Proof for this change">
      <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">Proof for this change</h3>
          <button type="button" onClick={onCancel} disabled={busy} aria-label="Close" className="text-gray-500 hover:text-gray-800 disabled:opacity-40"><X className="h-5 w-5" /></button>
        </div>
        <p className="mb-4 rounded-lg bg-gray-50 p-3 text-sm text-gray-800">
          Sold by: <strong>{fromName}</strong> → <strong>{toName}</strong>
        </p>
        <div className="space-y-3 text-sm">
          <p className="text-gray-600">Attach a file, or write what happened in at least {MIN_PROOF_NOTE} characters.</p>
          <FilePicker
            files={files}
            onChange={setFiles}
            max={MAX_ATTACHMENTS}
            accept={PROOF_FILES}
            label="Attach proof"
            icon={<Paperclip className="h-4 w-4" />}
            onError={setError}
            typesHint={TYPES}
            wrongType={(f) => `"${f.name}" can't be attached here — only ${TYPES} files.`}
          />
          <label className="block">
            <span className="mb-1 block font-medium text-gray-700">Note</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={MAX_NOTE}
              rows={3}
              placeholder="e.g. Closed by this salesman on a call with the customer on 5 Nov"
              className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          {!files.length && noteLength > 0 && noteLength < MIN_PROOF_NOTE && (
            <p className="text-xs text-gray-500">{MIN_PROOF_NOTE - noteLength} more characters needed, or attach a file.</p>
          )}
          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-40">Cancel</button>
          <button type="button" onClick={submit} disabled={!hasProof || busy}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Submit change
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
