'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { staffKeys } from '@/hooks/queries/keys';
import { errorMessage, type SalesTypeChangeOption } from '@/components/staff/sales/types';
import { payLaterKeys, salesTypeKeys } from './api';

const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
const label = 'block text-xs font-medium text-gray-700';

/** Said before the click, from what the server says the change will do. */
const EFFECT_WARNING: Record<string, string> = {
  withdrawn: 'This order may ship before payment. A B2C order cannot, so that will be taken back: the order will wait for payment again, and the teams and the admin get an email.',
  kept_shipped_unpaid: 'This order has already been shipped without payment. That will not be undone — the customer still has to pay. The admin gets an email.',
};

/**
 * Accounts / admin: change a GTM order B2B ↔ B2C after the check, with a reason.
 * The server decides whether it may (option.allowed / option.why), keeps every
 * change in the order's history, and never touches the money.
 */
export default function SalesTypeChange({ orderId, option, onDone }: { orderId: string; option: SalesTypeChangeOption; onDone?: () => void }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [company, setCompany] = useState({ legalName: '', gstin: '' });
  const [billing, setBilling] = useState({ addressLine1: '', city: '', postalCode: '' });
  const [error, setError] = useState('');
  const toB2B = option.to === 'b2b';

  const save = useMutation({
    mutationFn: () => apiClient.post(`/staff/orders/${encodeURIComponent(orderId)}/sales-type-change`, {
      to: option.to,
      reason: reason.trim(),
      ...(toB2B && {
        buyer: {
          legalName: company.legalName.trim(),
          gstin: company.gstin.trim().toUpperCase(),
          billingAddress: { addressLine1: billing.addressLine1.trim(), city: billing.city.trim(), postalCode: billing.postalCode.trim() },
        },
      }),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: salesTypeKeys.all });
      queryClient.invalidateQueries({ queryKey: payLaterKeys.all });
      queryClient.invalidateQueries({ queryKey: staffKeys.orders() });
      setOpen(false);
      setReason('');
      onDone?.();
    },
    onError: (e) => setError(errorMessage(e, 'Could not change the type.')),
  });

  if (!option.allowed) {
    return option.why ? <p className="text-xs text-gray-500">Change to {option.toLabel}: not possible — {option.why}</p> : null;
  }
  if (!open) {
    return (
      <button type="button" onClick={() => { setOpen(true); setError(''); }}
        className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-gray-50">
        Change to {option.toLabel}…
      </button>
    );
  }
  const id = (k: string) => `sales-type-change-${k}-${orderId}`;
  const ready = reason.trim().length >= 3
    && (!toB2B || (company.legalName.trim().length >= 2 && company.gstin.trim().length === 15
      && billing.addressLine1.trim() && billing.city.trim() && /^\d{6}$/.test(billing.postalCode)));
  const warning = EFFECT_WARNING[option.payLaterEffect];
  return (
    <form className="space-y-2 rounded-lg border border-blue-200 bg-blue-50/50 p-3" aria-label={`Change to ${option.toLabel}`}
      onSubmit={(e) => { e.preventDefault(); setError(''); save.mutate(); }}>
      <p className="text-xs font-semibold text-gray-900">Change this order to {option.toLabel}</p>
      <p className="text-xs text-gray-600">
        The amount does not change. The change and your reason are saved in the order’s history.
        {toB2B ? ' A B2B bill shows the company name and GSTIN.' : ' The company name and GSTIN are removed from the bill.'}
      </p>
      {toB2B && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor={id('name')}>Company name (as on GST registration)</label>
            <input id={id('name')} className={input} required minLength={2} maxLength={200} value={company.legalName}
              onChange={(e) => setCompany({ ...company, legalName: e.target.value })} />
          </div>
          <div>
            <label className={label} htmlFor={id('gstin')}>GSTIN</label>
            <input id={id('gstin')} className={`${input} uppercase`} required maxLength={15} placeholder="32ABCDE1234F1Z5" value={company.gstin}
              onChange={(e) => setCompany({ ...company, gstin: e.target.value.replace(/\s/g, '').toUpperCase() })} />
          </div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor={id('bill1')}>Billing address</label>
            <input id={id('bill1')} className={input} required maxLength={200} value={billing.addressLine1}
              onChange={(e) => setBilling({ ...billing, addressLine1: e.target.value })} />
          </div>
          <div>
            <label className={label} htmlFor={id('city')}>Billing city</label>
            <input id={id('city')} className={input} required maxLength={80} value={billing.city}
              onChange={(e) => setBilling({ ...billing, city: e.target.value })} />
          </div>
          <div>
            <label className={label} htmlFor={id('pin')}>Billing PIN code</label>
            <input id={id('pin')} className={input} required inputMode="numeric" maxLength={6} value={billing.postalCode}
              onChange={(e) => setBilling({ ...billing, postalCode: e.target.value.replace(/\D/g, '') })} />
          </div>
        </div>
      )}
      <label className={label} htmlFor={id('reason')}>Why are you changing it?</label>
      <textarea id={id('reason')} className={input} rows={2} required minLength={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)}
        placeholder={toB2B ? 'Example: Customer is a dealer, gave GSTIN' : 'Example: Customer is buying for personal use'} />
      {warning && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">{warning}</p>}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={save.isPending || !ready} className="rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
          Yes, change to {option.toLabel}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold">Close</button>
      </div>
    </form>
  );
}
