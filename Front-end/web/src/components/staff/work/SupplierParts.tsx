'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Banknote, History, Pencil, Plus, Replace, Split, Trash2 } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { formatDateIST } from '@/lib/datetime';
import { errorMessage } from '@/components/staff/sales/types';
import { paymentKeys, type OrderPayment } from '@/components/payments/api';
import PaymentRequestForm from '@/components/payments/PaymentRequestForm';
import PaymentRequestDetail from '@/components/payments/PaymentRequestDetail';
import { SupplierPaymentRow } from '@/components/payments/OrderSupplierPayments';
import type { SupplierPart, WorkOrder } from './types';

type Line = WorkOrder['lines'][number];
type OrderResponse = { success: boolean; order: WorkOrder };

/** Why a supplier is changed — the same list the server accepts (Back-end utils/supplierParts.js). */
export const CHANGE_REASONS: { value: string; label: string }[] = [
  { value: 'supplier_refunded', label: 'Supplier refunded' },
  { value: 'out_of_stock', label: 'Supplier out of stock' },
  { value: 'late', label: "Supplier can't deliver on time" },
  { value: 'price_changed', label: 'Supplier changed the price' },
  { value: 'quality', label: 'Quality problem' },
  { value: 'other', label: 'Other' },
];

const STATE: Record<SupplierPart['state'], { label: string; tone: string }> = {
  to_order: { label: 'To order', tone: 'bg-gray-100 text-gray-800' },
  payment_pending: { label: 'Payment Pending', tone: 'bg-amber-100 text-amber-900' },
  ordered: { label: 'Ordered From Supplier', tone: 'bg-emerald-100 text-emerald-800' },
  replaced: { label: 'Replaced', tone: 'bg-gray-100 text-gray-600' },
  removed: { label: 'Removed', tone: 'bg-gray-100 text-gray-600' },
};

const input = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none';
const primary = 'inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50';
const secondary = 'inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50';
const small = 'inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-50';

const live = (r: OrderPayment) => r.status !== 'declined' && r.status !== 'cancelled';
const partName = (p: Pick<SupplierPart, 'what' | 'supplierName'>) => (p.what ? `${p.what} · ${p.supplierName}` : p.supplierName);

/** Which part a supplier payment belongs to: its own, else the item's first part (raised before the split). */
export function paymentsByPart(parts: SupplierPart[], requests: OrderPayment[], itemId: string) {
  const mine = requests.filter((r) => r.kind !== 'expense' && r.itemIds.includes(itemId));
  const out = new Map<string, OrderPayment[]>(parts.map((p) => [p.id, []]));
  for (const r of mine) {
    const id = r.partId && out.has(r.partId) ? r.partId : parts[0]?.id;
    if (id) out.get(id)!.push(r);
  }
  return out;
}

/**
 * The supplier change history of one item, oldest first, in words:
 * "G S Enterprises → Trek N Trade · changed by Aromal S on 19 Nov 2026 · Supplier refunded — out of stock".
 * Read-only; shown to everyone who sees the order (admin, procurement, accounts).
 */
export function SupplierChanges({ parts, children }: { parts: SupplierPart[]; children?: (p: SupplierPart) => React.ReactNode }) {
  const gone = parts.filter((p) => p.status !== 'active');
  if (!gone.length) return null;
  const byId = new Map(parts.map((p) => [p.id, p]));
  return (
    <div className="space-y-1.5" aria-label="Supplier changes">
      <p className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-gray-500"><History className="h-3.5 w-3.5" /> Supplier changes</p>
      <ol className="space-y-2 border-l-2 border-gray-200 pl-3">
        {gone.map((p) => {
          const next = p.replacedWith ? byId.get(p.replacedWith) : null;
          return (
            <li key={p.id} className="space-y-1 text-sm">
              <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-gray-800">
                <span className="font-medium line-through decoration-gray-400">{p.supplierName || 'No supplier'}</span>
                {next ? (
                  <><ArrowRight className="h-3.5 w-3.5 text-gray-500" aria-label="changed to" /><span className="font-medium">{next.supplierName}</span></>
                ) : <span className="text-gray-600">removed</span>}
                {p.what && <span className="text-gray-500">({p.what})</span>}
              </p>
              <p className="text-xs text-gray-600">
                {p.status === 'replaced' ? 'Changed' : 'Removed'}{p.replacedByName ? ` by ${p.replacedByName}` : ''}{p.replacedAt ? ` on ${formatDateIST(p.replacedAt)}` : ''}
                {p.reason && <> · <span className="text-gray-800">{p.reason}</span></>}
              </p>
              {children?.(p)}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * "Suppliers for this item", on the item's card in the procurement order view.
 *
 * - An item never split shows today's single-supplier view (LineSupplierPayment) and,
 *   for procurement, "Change supplier" / "Split across suppliers" under it.
 * - A split item lists each part — what is bought, its supplier, its status and its
 *   own supplier payments — then the change history (old suppliers are never deleted;
 *   their payments stay listed, and a paid one offers "Supplier must refund").
 *
 * Every change goes to the server (which re-checks who may act and the rules) and
 * the order is shown as the server returns it — nothing here is optimistic.
 */
export default function SupplierParts({ order, line, requests, onDone }: {
  order: WorkOrder; line: Line; requests: OrderPayment[]; onDone: (res: OrderResponse) => void;
}) {
  const qc = useQueryClient();
  const parts = line.supplierParts ?? [];
  const canEdit = line.actions.includes('supplier_parts');
  const [mode, setMode] = useState<null | { kind: 'add' } | { kind: 'change' | 'edit' | 'pay'; part: SupplierPart }>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<{ id: string; edit: boolean } | null>(null);
  const base = `/staff/work/orders/${order.id}/lines/${line.itemId}/parts`;
  const refreshPayments = () => qc.invalidateQueries({ queryKey: paymentKeys.forOrder(order.id) });

  const send = useMutation({
    mutationFn: async ({ path, body, method = 'post' }: { path: string; body: unknown; method?: 'post' | 'patch' }) =>
      (method === 'patch' ? apiClient.patch<OrderResponse>(`${base}${path}`, body) : apiClient.post<OrderResponse>(`${base}${path}`, body)),
    onSuccess: (res) => { setError(''); setMode(null); onDone(res); refreshPayments(); },
    onError: (e) => setError(errorMessage(e, 'That did not work. Please try again.')),
  });

  const byPart = paymentsByPart(parts, requests, line.itemId);
  const active = parts.filter((p) => p.status === 'active');
  const itemName = line.variantLabel ? `${line.name} — ${line.variantLabel}` : line.name;
  const err = error && <p role="alert" className="text-sm text-red-700">{error}</p>;

  // ── Not split: the usual view stays; procurement gets the two ways in. ──
  if (!line.split) {
    if (!canEdit) return null;
    const current = parts[0] ?? null;
    return (
      <div className="space-y-2">
        {!mode && (
          <div className="flex flex-wrap gap-2">
            {current && (
              <button type="button" className={small} onClick={() => setMode({ kind: 'change', part: current })}>
                <Replace className="h-3 w-3" /> Change supplier
              </button>
            )}
            <button type="button" className={small} onClick={() => setMode({ kind: 'add' })}
              title="Buy parts of this item from different suppliers — e.g. the can from one, the mount from another">
              <Split className="h-3 w-3" /> Split across suppliers
            </button>
          </div>
        )}
        {mode?.kind === 'change' && <ChangeForm part={mode.part} payments={byPart.get(mode.part.id) ?? []} busy={send.isPending}
          onCancel={() => setMode(null)} onSubmit={(body) => send.mutate({ path: `/${mode.part.id}/change`, body })} />}
        {mode?.kind === 'add' && <AddForm first={current} busy={send.isPending} onCancel={() => setMode(null)}
          onSubmit={(body) => send.mutate({ path: '', body })} />}
        {err}
      </div>
    );
  }

  // ── Split: every part with its own supplier, status and payments. ──
  return (
    <div className="space-y-3 rounded-lg border border-gray-200 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Suppliers for this item</p>
      <ul className="space-y-3">
        {active.map((p, i) => {
          const pays = byPart.get(p.id) ?? [];
          const canPay = canEdit && p.state === 'to_order' && !pays.some((r) => live(r) && r.status !== 'paid');
          const canRemove = canEdit && active.length > 1 && !pays.some(live) && p.state === 'to_order';
          return (
            <li key={p.id} className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-gray-500">Part {i + 1}</span>
                <span className="font-medium text-gray-900">{p.what || 'Item'}</span>
                <span className="text-sm text-gray-600">from {p.supplierName}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATE[p.state].tone}`}>{STATE[p.state].label}</span>
                {canEdit && !mode && (
                  <span className="ml-auto flex flex-wrap gap-1.5">
                    <button type="button" className={small} onClick={() => setMode({ kind: 'change', part: p })}><Replace className="h-3 w-3" /> Change supplier</button>
                    <button type="button" className={small} aria-label={`Edit part ${i + 1}`} onClick={() => setMode({ kind: 'edit', part: p })}><Pencil className="h-3 w-3" /> Edit</button>
                    {canRemove && (
                      <button type="button" className={small} aria-label={`Remove part ${i + 1}`}
                        onClick={() => { if (window.confirm(`Remove "${partName(p)}"? It stays in the history.`)) send.mutate({ path: `/${p.id}/remove`, body: {} }); }}>
                        <Trash2 className="h-3 w-3" /> Remove
                      </button>
                    )}
                  </span>
                )}
              </div>
              {pays.map((r) => <SupplierPaymentRow key={r.id} r={r} onOpen={(edit) => setOpen({ id: r.id, edit })} />)}
              {canPay && mode?.kind !== 'pay' && (
                <button type="button" onClick={() => setMode({ kind: 'pay', part: p })}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400 bg-amber-100 px-3 py-1.5 text-sm font-semibold text-amber-900 hover:bg-amber-200">
                  <Banknote className="h-4 w-4" /> Request payment to {p.supplierName}
                </button>
              )}
              {mode?.kind === 'pay' && mode.part.id === p.id && (
                <PaymentRequestForm
                  supplier={{
                    orderId: order.id,
                    orderNumber: order.orderNumber,
                    customer: order.customer.name,
                    closedBy: order.source === 'sales' ? `GTM lead: ${order.soldBy}` : 'Website',
                    lines: [{ itemId: line.itemId, name: p.what ? `${itemName} · part: ${p.what}` : itemName }],
                    partId: p.id,
                  }}
                  onCancel={() => setMode(null)}
                  onDone={() => {
                    setMode(null);
                    refreshPayments();
                    // The item moves to "Payment Pending".
                    qc.invalidateQueries({ predicate: (query) => JSON.stringify(query.queryKey).includes(order.id) });
                  }}
                />
              )}
              {mode?.kind === 'change' && mode.part.id === p.id && <ChangeForm part={p} payments={pays} busy={send.isPending}
                onCancel={() => setMode(null)} onSubmit={(body) => send.mutate({ path: `/${p.id}/change`, body })} />}
              {mode?.kind === 'edit' && mode.part.id === p.id && <EditForm part={p} paid={pays.some(live)} busy={send.isPending}
                onCancel={() => setMode(null)} onSubmit={(body) => send.mutate({ path: `/${p.id}`, body, method: 'patch' })} />}
            </li>
          );
        })}
      </ul>
      {canEdit && !mode && (
        <button type="button" className={secondary} onClick={() => setMode({ kind: 'add' })}><Plus className="h-4 w-4" /> Add another supplier part</button>
      )}
      {mode?.kind === 'add' && <AddForm busy={send.isPending} onCancel={() => setMode(null)} onSubmit={(body) => send.mutate({ path: '', body })} />}
      {err}
      <SupplierChanges parts={parts}>
        {(p) => (byPart.get(p.id) ?? []).map((r) => <SupplierPaymentRow key={r.id} r={r} muted onOpen={(edit) => setOpen({ id: r.id, edit })} />)}
      </SupplierChanges>
      {open && <PaymentRequestDetail id={open.id} startEditing={open.edit} onClose={() => { setOpen(null); refreshPayments(); }} />}
    </div>
  );
}

function AddForm({ first, busy, onCancel, onSubmit }: {
  first?: SupplierPart | null; busy: boolean; onCancel: () => void; onSubmit: (body: { supplierName: string; what: string }) => void;
}) {
  const [supplierName, setSupplierName] = useState('');
  const [what, setWhat] = useState('');
  return (
    <form className="space-y-2 rounded-lg border border-blue-200 bg-blue-50/40 p-3"
      onSubmit={(e) => { e.preventDefault(); onSubmit({ supplierName: supplierName.trim(), what: what.trim() }); }}>
      <p className="text-sm font-semibold text-gray-900">{first ? 'Split across suppliers' : 'Add a supplier part'}</p>
      <p className="text-xs text-gray-600">
        {first
          ? `${first.supplierName} stays as part 1 (you can name what it supplies after). Add what comes from another supplier — for example "Locking mount" from Mount Co. Each part gets its own payment.`
          : 'For example "Jerry can" from Trek N Trade. Add one part at a time; each part gets its own payment.'}
      </p>
      <label className="block text-xs font-medium text-gray-700">What is bought <span className="font-normal text-gray-500">(optional)</span>
        <input className={input} maxLength={120} value={what} onChange={(e) => setWhat(e.target.value)} placeholder="e.g. Locking mount" />
      </label>
      <label className="block text-xs font-medium text-gray-700">Supplier
        <input className={input} required maxLength={120} value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="e.g. Mount Co" />
      </label>
      <div className="flex gap-2">
        <button type="submit" className={primary} disabled={busy || !supplierName.trim()}>Add part</button>
        <button type="button" className={secondary} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function EditForm({ part, paid, busy, onCancel, onSubmit }: {
  part: SupplierPart; paid: boolean; busy: boolean; onCancel: () => void; onSubmit: (body: { what: string; supplierName?: string }) => void;
}) {
  const [what, setWhat] = useState(part.what);
  const [supplierName, setSupplierName] = useState(part.supplierName);
  return (
    <form className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3"
      onSubmit={(e) => { e.preventDefault(); onSubmit({ what: what.trim(), ...(paid ? {} : { supplierName: supplierName.trim() }) }); }}>
      <label className="block text-xs font-medium text-gray-700">What is bought
        <input className={input} maxLength={120} value={what} onChange={(e) => setWhat(e.target.value)} />
      </label>
      <label className="block text-xs font-medium text-gray-700">Supplier
        <input className={input} required maxLength={120} value={supplierName} disabled={paid} onChange={(e) => setSupplierName(e.target.value)} />
      </label>
      {paid && <p className="text-xs text-gray-600">This part has a supplier payment — to switch supplier, use &ldquo;Change supplier&rdquo; (with a reason).</p>}
      <div className="flex gap-2">
        <button type="submit" className={primary} disabled={busy}>Save</button>
        <button type="button" className={secondary} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function ChangeForm({ part, payments, busy, onCancel, onSubmit }: {
  part: SupplierPart; payments: OrderPayment[]; busy: boolean; onCancel: () => void;
  onSubmit: (body: { supplierName: string; reasonCode: string; reasonNote: string }) => void;
}) {
  const [supplierName, setSupplierName] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [reasonNote, setReasonNote] = useState('');
  const waiting = payments.filter((r) => r.status === 'submitted');
  const approved = payments.filter((r) => r.status === 'approved' || r.status === 'on_hold');
  const paid = payments.filter((r) => r.status === 'paid');
  const needsNote = reasonCode === 'other';
  const ready = supplierName.trim() && reasonCode && (!needsNote || reasonNote.trim().length >= 3) && !approved.length;
  return (
    <form className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3"
      onSubmit={(e) => { e.preventDefault(); onSubmit({ supplierName: supplierName.trim(), reasonCode, reasonNote: reasonNote.trim() }); }}>
      <p className="text-sm font-semibold text-gray-900">Change supplier{part.what ? ` for ${part.what}` : ''}</p>
      <p className="text-xs text-gray-600">Now: <span className="font-medium text-gray-800">{part.supplierName}</span>. It stays in the history with your reason — nothing is deleted.</p>
      <label className="block text-xs font-medium text-gray-700">New supplier
        <input className={input} required maxLength={120} value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="e.g. Trek N Trade" />
      </label>
      <label className="block text-xs font-medium text-gray-700">Why
        <select className={input} required value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
          <option value="">Choose a reason…</option>
          {CHANGE_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </label>
      <label className="block text-xs font-medium text-gray-700">Details {needsNote ? '' : <span className="font-normal text-gray-500">(optional)</span>}
        <textarea className={input} rows={2} maxLength={300} required={needsNote} value={reasonNote} onChange={(e) => setReasonNote(e.target.value)} placeholder="e.g. out of stock — refunded ₹2,065 on 18 Nov" />
      </label>
      {waiting.map((r) => <p key={r.id} className="text-xs text-amber-900">{r.number} is waiting for approval — it will be cancelled.</p>)}
      {approved.map((r) => (
        <p key={r.id} role="alert" className="text-xs font-medium text-red-700">
          {r.number} is already approved by accounts and not paid. Ask accounts to {r.status === 'on_hold' ? 'decline it' : 'put it on hold and decline it'} first.
        </p>
      ))}
      {paid.map((r) => (
        <p key={r.id} className="text-xs text-gray-700">{r.number} is paid — it stays paid. After the change, press &ldquo;Supplier must refund&rdquo; on it to get the money back.</p>
      ))}
      <div className="flex gap-2">
        <button type="submit" className={primary} disabled={busy || !ready}>Change supplier</button>
        <button type="button" className={secondary} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
