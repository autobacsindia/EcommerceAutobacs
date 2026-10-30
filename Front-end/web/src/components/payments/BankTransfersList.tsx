'use client';

import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, FileText, Loader2, Pencil, X } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { staffKeys } from '@/hooks/queries/keys';
import { formatDateIST, formatDateTimeIST } from '@/lib/datetime';
import { errorMessage, rupees } from '@/components/staff/sales/types';

export type BankTransferStatus = 'pending' | 'confirmed' | 'rejected' | 'withdrawn';

export type BankTransfer = {
  id: string;
  orderId: string;
  orderNumber: string;
  customer: { name: string; city: string };
  salesPerson: string;
  amount: number;
  reference: string;
  paidOn: string;
  note: string;
  status: BankTransferStatus;
  statusLabel: string;
  recordedBy: string;
  recordedAt: string;
  reviewedBy: string;
  reviewedAt: string | null;
  reviewNote: string;
  files: { id: string; name: string; contentType: string; bytes: number }[];
  can: { confirm: boolean; reject: boolean; edit?: boolean; withdraw?: boolean };
  /** Whoever recorded it may correct it until then (null for admins / once closed). */
  editableUntil?: string | null;
};

type Page = { transfers: BankTransfer[]; nextCursor: string | null };

const TABS: { value: BankTransferStatus | 'all'; label: string }[] = [
  { value: 'pending', label: 'To check' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All' },
];

const BADGE: Record<BankTransferStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  confirmed: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  withdrawn: 'bg-gray-200 text-gray-700',
};

export const transferFileHref = (id: string, fileId: string) =>
  `/api/v1/staff/bank-transfers/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}`;

function TransferCard({ t }: { t: BankTransfer }) {
  const queryClient = useQueryClient();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [fix, setFix] = useState({ reference: t.reference, paidOn: String(t.paidOn || '').slice(0, 10), note: t.note || '' });
  // Confirming pays the order, so every order list refreshes with the transfer lists.
  const refresh = () => queryClient.invalidateQueries({ queryKey: staffKeys.orders() });

  const confirm = useMutation({
    mutationFn: () => apiClient.post(`/staff/bank-transfers/${encodeURIComponent(t.id)}/confirm`, {}),
    onSuccess: () => { setError(''); refresh(); },
    onError: (e) => setError(errorMessage(e, 'Could not confirm this transfer.')),
  });
  const reject = useMutation({
    mutationFn: () => apiClient.post(`/staff/bank-transfers/${encodeURIComponent(t.id)}/reject`, { note: reason.trim() }),
    onSuccess: () => { setError(''); setRejecting(false); refresh(); },
    onError: (e) => setError(errorMessage(e, 'Could not reject this transfer.')),
  });
  const edit = useMutation({
    mutationFn: () => apiClient.put(`/staff/bank-transfers/${encodeURIComponent(t.id)}`, {
      reference: fix.reference.trim(), paidOn: fix.paidOn, note: fix.note.trim(),
    }),
    onSuccess: () => { setError(''); setEditing(false); refresh(); },
    onError: (e) => setError(errorMessage(e, 'Could not save the changes.')),
  });
  const withdraw = useMutation({
    mutationFn: () => apiClient.post(`/staff/bank-transfers/${encodeURIComponent(t.id)}/withdraw`, {}),
    onSuccess: () => { setError(''); refresh(); },
    onError: (e) => setError(errorMessage(e, 'Could not withdraw this transfer.')),
  });
  const busy = confirm.isPending || reject.isPending || edit.isPending || withdraw.isPending;

  return (
    <li className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">
            {t.orderNumber} · {rupees(t.amount)}
          </p>
          <p className="text-sm text-gray-600">
            {t.customer.name || 'Customer'}{t.customer.city ? ` · ${t.customer.city}` : ''}
            {t.salesPerson ? ` · sold by ${t.salesPerson}` : ''}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${BADGE[t.status]}`}>{t.statusLabel}</span>
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div className="flex gap-2"><dt className="text-gray-500">UTR / reference</dt><dd className="font-mono font-medium text-gray-900 break-all">{t.reference}</dd></div>
        <div className="flex gap-2"><dt className="text-gray-500">Paid on</dt><dd className="text-gray-900">{formatDateIST(t.paidOn)}</dd></div>
        <div className="flex gap-2 sm:col-span-2"><dt className="text-gray-500">Recorded</dt><dd className="text-gray-900">{t.recordedBy}, {formatDateTimeIST(t.recordedAt)}</dd></div>
        {t.reviewedAt && (
          <div className="flex gap-2 sm:col-span-2">
            <dt className="text-gray-500">{t.status === 'rejected' ? 'Rejected' : 'Confirmed'}</dt>
            <dd className="text-gray-900">{t.reviewedBy}, {formatDateTimeIST(t.reviewedAt)}</dd>
          </div>
        )}
      </dl>
      {t.note && <p className="mt-2 rounded-lg bg-gray-50 p-2 text-sm text-gray-700">GTM: {t.note}</p>}
      {t.reviewNote && <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-800">Reason: {t.reviewNote}</p>}

      {t.files.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {t.files.map((f, i) => (
            <a key={f.id} href={transferFileHref(t.id, f.id)} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50">
              <FileText className="h-4 w-4 text-emerald-700" /> {f.contentType === 'application/pdf' ? 'PDF' : 'Screenshot'} {t.files.length > 1 ? i + 1 : ''}
            </a>
          ))}
        </div>
      )}

      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {t.can.withdraw && !editing && (
        <button type="button" disabled={busy}
          onClick={() => { if (window.confirm(`Withdraw this bank transfer on ${t.orderNumber}? Use this only if it was recorded by mistake — the order becomes unpaid again.`)) withdraw.mutate(); }}
          className="mr-2 mt-3 inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">
          <X className="h-4 w-4" /> Withdraw
        </button>
      )}
      {t.can.edit && !editing && (
        <button type="button" onClick={() => setEditing(true)}
          title={t.editableUntil ? `You can edit until ${formatDateTimeIST(t.editableUntil)}` : undefined}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
          <Pencil className="h-4 w-4" /> Edit
        </button>
      )}
      {editing && (
        <form className="mt-3 space-y-2" aria-label="Edit bank transfer" onSubmit={(e) => { e.preventDefault(); edit.mutate(); }}>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-sm"><span className="mb-1 block font-medium text-gray-800">UTR / bank reference</span>
              <input value={fix.reference} onChange={(e) => setFix({ ...fix, reference: e.target.value })} required className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" /></label>
            <label className="block text-sm"><span className="mb-1 block font-medium text-gray-800">Date paid</span>
              <input type="date" value={fix.paidOn} onChange={(e) => setFix({ ...fix, paidOn: e.target.value })} required className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" /></label>
          </div>
          <label className="block text-sm"><span className="mb-1 block font-medium text-gray-800">Note</span>
            <textarea value={fix.note} onChange={(e) => setFix({ ...fix, note: e.target.value })} rows={2} maxLength={500} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" /></label>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {edit.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save changes
            </button>
            <button type="button" onClick={() => setEditing(false)} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700">Cancel</button>
          </div>
        </form>
      )}

      {t.can.confirm && !rejecting && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" disabled={busy}
            onClick={() => {
              if (window.confirm(`Is ${rupees(t.amount)} with reference ${t.reference} in the company bank account? Confirming marks ${t.orderNumber} as paid and sends it to Procurement.`)) confirm.mutate();
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
            {confirm.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Money is in the bank — confirm
          </button>
          {t.can.reject && (
            <button type="button" disabled={busy} onClick={() => setRejecting(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">
              <X className="h-4 w-4" /> Not received — reject
            </button>
          )}
        </div>
      )}

      {rejecting && (
        <div className="mt-4 space-y-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-800">Why? GTM passes this on to the customer.</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} autoFocus
              placeholder="For example: no credit with this UTR in the bank"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-100" />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || reason.trim().length < 3} onClick={() => reject.mutate()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
              {reject.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Reject transfer
            </button>
            <button type="button" disabled={busy} onClick={() => { setRejecting(false); setError(''); }}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              Back
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * Bank transfers a salesman recorded for a sales order. Accounts and the admin
 * confirm (the order becomes paid) or reject; the GTM head sees all of them, a
 * GTM lead sees their own. The server decides who sees and may do what.
 */
export default function BankTransfersList() {
  const [status, setStatus] = useState<BankTransferStatus | 'all'>('pending');
  const q = useInfiniteQuery({
    queryKey: staffKeys.bankTransfers(status),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ status, ...(pageParam ? { cursor: pageParam } : {}) });
      return apiClient.get<Page>(`/staff/bank-transfers?${params}`);
    },
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor || undefined,
    refetchInterval: 60_000,
  });
  const rows = q.data?.pages.flatMap((p) => p.transfers) ?? [];

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Bank transfer status" className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button key={tab.value} type="button" role="tab" aria-selected={status === tab.value} onClick={() => setStatus(tab.value)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${status === tab.value ? 'bg-gray-900 text-white' : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
            {tab.label}
          </button>
        ))}
      </div>

      {q.isPending && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
      {q.isError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorMessage(q.error, 'Could not load bank transfers.')}</p>}
      {q.isSuccess && rows.length === 0 && (
        <p className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
          {status === 'pending' ? 'Nothing to check. New bank transfers appear here.' : 'No bank transfers here yet.'}
        </p>
      )}

      <ul className="space-y-3">
        {rows.map((t) => <TransferCard key={t.id} t={t} />)}
      </ul>

      {q.hasNextPage && (
        <button type="button" disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          {q.isFetchingNextPage ? 'Loading…' : 'Show more'}
        </button>
      )}
    </div>
  );
}
