'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, Landmark, Loader2, Pencil, ShieldCheck, Trash2 } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { staffKeys } from '@/hooks/queries/keys';
import { formatDateTimeIST } from '@/lib/datetime';
import { errorMessage } from './types';

type BankAccount = {
  accountName: string;
  /** XXXXXXXX1234 — or, for accounts / admin after "Show", the full number. */
  accountNumber: string;
  last4: string;
  ifsc: string;
  bankName: string;
  savedBy: string;
  updatedAt: string;
};
type BankResponse = { success: boolean; account: BankAccount | null; canReveal: boolean; canSave: boolean; hasMobile: boolean };

const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const digits = (s: string) => s.replace(/[\s-]/g, '');
const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
const EMPTY = { accountName: '', accountNumber: '', confirmAccountNumber: '', ifsc: '', bankName: '' };

/**
 * The customer's saved bank account — for refunds and NEFT only, never a card.
 *
 * Reached through a quotation or an order (`kind` + `id`); saved under the
 * customer's mobile, so it shows again on their next quotation and order. Masked
 * for everyone; accounts and admin may "Show" the full number (the server logs
 * each look). The full number is held only in this component's state, never in
 * the query cache, and is hidden again when the card is left.
 */
export default function CustomerBankCard({ kind, id }: { kind: 'quotation' | 'order'; id: string }) {
  const qc = useQueryClient();
  const path = `/staff/customer-bank/${kind}/${encodeURIComponent(id)}`;
  const key = staffKeys.customerBank(kind, id);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [full, setFull] = useState<string | null>(null);

  const q = useQuery({ queryKey: key, queryFn: () => apiClient.get<BankResponse>(path) });
  const done = (res: BankResponse) => {
    qc.setQueryData(key, res);
    // The same customer's other quotations / orders read the same account; this one
    // already holds the server's answer, so it is not fetched again.
    const own = JSON.stringify(key);
    qc.invalidateQueries({ queryKey: staffKeys.customerBanks(), predicate: (query) => JSON.stringify(query.queryKey) !== own });
    setEditing(false);
    setForm(EMPTY);
    setFull(null);
    setError('');
  };

  const save = useMutation({
    mutationFn: () => apiClient.put<BankResponse>(path, {
      ...form,
      accountNumber: digits(form.accountNumber),
      confirmAccountNumber: digits(form.confirmAccountNumber),
      ifsc: form.ifsc.trim().toUpperCase(),
    }),
    onSuccess: done,
    onError: (e) => setError(errorMessage(e, 'Could not save the bank details.')),
  });
  const remove = useMutation({
    mutationFn: () => apiClient.delete<BankResponse>(path),
    onSuccess: done,
    onError: (e) => setError(errorMessage(e, 'Could not remove the bank details.')),
  });
  const reveal = useMutation({
    mutationFn: () => apiClient.get<BankResponse>(`${path}?reveal=1`),
    onSuccess: (res) => setFull(res.account?.accountNumber ?? null),
    onError: (e) => setError(errorMessage(e, 'Could not show the account number.')),
  });

  if (q.isPending) return null;
  if (q.isError || !q.data) return null; // not this person's to see — show nothing
  const { account, canReveal, hasMobile } = q.data;

  const number = digits(form.accountNumber);
  const formError = !form.accountName.trim() ? 'Enter the account holder\'s name.'
    : !/^\d{6,18}$/.test(number) ? 'Enter the account number (6–18 digits).'
      : digits(form.confirmAccountNumber) !== number ? 'The two account numbers do not match.'
        : !IFSC.test(form.ifsc.trim().toUpperCase()) ? 'Enter a valid IFSC code (e.g. HDFC0001234).'
          : '';
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  const busy = save.isPending || remove.isPending;

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 text-sm" aria-label="Customer bank details">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Landmark className="h-4 w-4 text-gray-500" />
          <h2 className="font-semibold text-gray-900">Customer bank details</h2>
        </div>
        <span className="inline-flex items-center gap-1 text-xs text-gray-500"><ShieldCheck className="h-3.5 w-3.5 text-green-600" /> For refunds / NEFT · stored encrypted</span>
      </div>

      {!hasMobile && <p className="text-gray-500">This customer has no mobile number, so bank details cannot be saved for them.</p>}

      {hasMobile && account && !editing && (
        <div className="space-y-1">
          <p className="text-gray-900">{account.accountName}</p>
          <p className="flex flex-wrap items-center gap-2 font-mono text-gray-800">
            {full ?? account.accountNumber}
            {canReveal && (full ? (
              <button type="button" onClick={() => setFull(null)} className="inline-flex items-center gap-1 font-sans text-xs font-medium text-blue-700 hover:text-blue-900">
                <EyeOff className="h-3.5 w-3.5" /> Hide
              </button>
            ) : (
              <button type="button" disabled={reveal.isPending} onClick={() => reveal.mutate()} className="inline-flex items-center gap-1 font-sans text-xs font-medium text-blue-700 hover:text-blue-900 disabled:opacity-50">
                <Eye className="h-3.5 w-3.5" /> Show full number
              </button>
            ))}
          </p>
          <p className="text-gray-700">{account.ifsc}{account.bankName ? ` · ${account.bankName}` : ''}</p>
          <p className="text-xs text-gray-500">Saved{account.savedBy ? ` by ${account.savedBy}` : ''} · {formatDateTimeIST(account.updatedAt)}</p>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={() => { setEditing(true); setFull(null); setError(''); }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-800 hover:bg-gray-50">
              <Pencil className="h-3.5 w-3.5" /> Change
            </button>
            <button type="button" disabled={busy}
              onClick={() => { if (window.confirm('Remove the saved bank details for this customer?')) remove.mutate(); }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </button>
          </div>
        </div>
      )}

      {hasMobile && !account && !editing && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-gray-500">No bank details saved for this customer.</p>
          <button type="button" onClick={() => { setEditing(true); setError(''); }}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
            Add bank details
          </button>
        </div>
      )}

      {hasMobile && editing && (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (!formError) save.mutate(); }}>
          <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
            Bank account only — <strong>never enter card numbers, CVV or UPI PINs</strong>. Card payments go through the Razorpay link.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-gray-700">Account holder name</span>
              <input className={input} value={form.accountName} onChange={set('accountName')} autoComplete="off" maxLength={120} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-700">Account number</span>
              <input className={input} value={form.accountNumber} onChange={set('accountNumber')} inputMode="numeric" autoComplete="off" maxLength={30} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-700">Confirm account number</span>
              <input className={input} value={form.confirmAccountNumber} onChange={set('confirmAccountNumber')} inputMode="numeric" autoComplete="off" maxLength={30}
                onPaste={(e) => e.preventDefault()} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-700">IFSC</span>
              <input className={`${input} uppercase`} value={form.ifsc} onChange={set('ifsc')} autoComplete="off" maxLength={11} placeholder="HDFC0001234" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-700">Bank name (optional)</span>
              <input className={input} value={form.bankName} onChange={set('bankName')} autoComplete="off" maxLength={120} />
            </label>
          </div>
          {form.accountNumber && formError && <p className="text-xs text-red-700">{formError}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={!!formError || busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save bank details
            </button>
            <button type="button" onClick={() => { setEditing(false); setForm(EMPTY); setError(''); }}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50">
              Cancel
            </button>
          </div>
          {account && <p className="text-xs text-gray-500">Saving replaces the account ending {account.last4}.</p>}
        </form>
      )}

      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    </section>
  );
}
