'use client';

import CopyId from '@/components/ui/CopyId';
import EntityLink from '@/components/ui/EntityLink';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Link2, Loader2, Paperclip, Pencil, X } from 'lucide-react';
import { formatDateIST, formatDateTimeIST } from '@/lib/datetime';
import EditHistory from './EditHistory';
import { cardLabelOf } from './CardFields';
import {
  accountName, actOn, kmText, amountText, bankCode, linkOrder, setLinks, type OrderMatch, billAmount, categoryName, errorMessage, fileHref, foreignBill, getRequest, money, paidHow, paymentKeys, postForm, rupees, slipHref, STATUS_TONE, type PaymentRequest, toLocalInput, fromLocalInput } from './api';
import FilePicker from './FilePicker';
import { useSlipReader } from './slipReader';
import SlipReadStatus, { SlipFieldTag, SlipSources } from './SlipReadStatus';
import { MAX_ATTACHMENTS, PHOTO_OR_PDF } from '@/lib/attachments';
import EditPaymentRequest from './EditPaymentRequest';
import EditPaidPayment from './EditPaidPayment';
import OrderTypeTag from '@/components/orders/OrderTypeTag';
import OrderPicker from './OrderPicker';
import DealSummaryBox from './DealSummary';
import { SupplierRefundLine } from './SupplierCredit';
import { CreditControl, CreditSum } from './RequestCredit';
import RichText from '@/components/ui/RichText';
import { heldByText } from './HoldLine';

/** The server takes up to three payment screenshots per payment. */
const MAX_PROOFS = MAX_ATTACHMENTS;

const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50';

const ACTION_LABELS: Record<string, string> = {
  // Who acted is shown beside each entry: accounts (who approved) or the admin (who paid).
  submitted: 'Raised', approved: 'Approved', declined: 'Declined',
  on_hold: 'Put on hold', released: 'Hold released', paid: 'Paid', cancelled: 'Cancelled', edited: 'Edited', payment_edited: 'Payment record corrected',
};
const FILE_LABELS = { bill: 'Bill / invoice', qr: 'Payment QR', proof: 'Payment screenshot' } as const;

/** How the payee is paid, in one line; '' (row hidden) is never shown — "Not given yet" instead. */
function payByLine(p: PaymentRequest['payee']): string {
  if (p.method === 'upi') return `UPI · ${p.upiId || 'scan their QR (attached)'}`;
  if (p.method === 'card') return `Card · ${cardLabelOf(p) || 'details not given yet'}`;
  if (p.method === 'bank') {
    const parts = [p.accountName, p.accountNumber ? `A/c ${p.accountNumber}` : '', bankCode(p)].filter(Boolean);
    return `Bank · ${parts.join(', ') || 'details not given yet'}${p.bankName ? ` (${p.bankName})` : ''}`;
  }
  return 'Not given yet — accounts can add it';
}

function Row({ k, v, copy }: { k: string; v?: string | null; /** Names a copy icon after the value ("Order number"). */ copy?: string }) {
  if (!v) return null;
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2 py-1 text-sm">
      <dt className="text-gray-500">{k}</dt>
      <dd className="break-words text-gray-900">{v}{copy && <CopyId value={v} label={copy} className="ml-1" />}</dd>
    </div>
  );
}

/**
 * Which order an expense was for: "Link to order" when none, else the order with
 * Change / Remove. Any status — it changes no money; the server keeps it in the
 * history. A supplier payment's order is fixed and shown as a plain row.
 */
function OrderLinkRow({ r, onSaved }: { r: PaymentRequest; onSaved: (next: PaymentRequest, was: string | null) => void }) {
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<OrderMatch | null>(null);
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: async (orderId: string | null) => (await linkOrder(r.id, orderId)).request,
    onSuccess: (next) => { onSaved(next, r.order?.id ?? null); setPicking(false); setPicked(null); setError(''); },
    onError: (e) => setError(errorMessage(e, 'Could not change the order. Refresh and try again.')),
  });
  const may = Boolean(r.can.linkOrder);
  if (!r.order && !may) return null;
  const small = 'inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-0.5 text-xs font-medium hover:bg-gray-50 disabled:opacity-50';
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2 py-1 text-sm">
      <dt className="text-gray-500">Order</dt>
      <dd className="space-y-2 text-gray-900">
        {!picking && (
          <div className="flex flex-wrap items-center gap-2">
            {r.order
              ? <EntityLink type="order" id={r.order.id} value={r.order.number} label="Order number" className="font-medium" />
              : <span className="text-gray-500">Not linked to an order</span>}
            {may && (
              <button type="button" onClick={() => setPicking(true)} className={`${small} text-blue-700`}>
                <Link2 className="h-3 w-3" /> {r.order ? 'Change' : 'Link to order'}
              </button>
            )}
            {may && r.order && (
              <button type="button" disabled={save.isPending} onClick={() => { if (window.confirm(`Remove order ${r.order!.number} from ${r.number}?`)) save.mutate(null); }} className={`${small} text-red-700`}>
                <X className="h-3 w-3" /> Remove
              </button>
            )}
          </div>
        )}
        {picking && (
          <div className="space-y-2 rounded-lg border border-gray-200 p-2">
            <OrderPicker id={`link-${r.id}`} picked={picked} onPick={setPicked} autoFocus />
            <div className="flex gap-2">
              <button type="button" disabled={!picked || save.isPending} onClick={() => picked && save.mutate(picked.id)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Link {picked ? picked.number : 'order'}
              </button>
              <button type="button" onClick={() => { setPicking(false); setPicked(null); setError(''); }} className="rounded-lg px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-100">Cancel</button>
            </div>
          </div>
        )}
        {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      </dd>
    </div>
  );
}

/**
 * Which project and other ID a request belongs to, with Edit. Any status and
 * kind — no money changes; the server checks the project exists and keeps every
 * change in the history.
 */
function ProjectLinkRows({ r, onSaved }: { r: PaymentRequest; onSaved: (next: PaymentRequest) => void }) {
  const [editing, setEditing] = useState(false);
  const [project, setProject] = useState(r.project?.code ?? '');
  const [reference, setReference] = useState(r.reference ?? '');
  const [task, setTask] = useState(r.task?.code ?? '');
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: async () => (await setLinks(r.id, {
      project: project.trim(), reference: reference.trim(),
      // Only sent when changed: the server checks the person may still see the task.
      ...(task.trim() !== (r.task?.code ?? '') ? { task: task.trim() } : {}),
    })).request,
    onSuccess: (next) => { onSaved(next); setEditing(false); setError(''); },
    onError: (e) => setError(errorMessage(e, 'Could not save. Refresh and try again.')),
  });
  const may = Boolean(r.can.linkProject);
  if (!r.project && !r.reference && !r.task && !may) return null;
  const field = 'w-full rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none';
  if (editing) {
    return (
      <div className="grid grid-cols-[120px_1fr] gap-2 py-1 text-sm">
        <dt className="text-gray-500">Project / task / other ID</dt>
        <dd className="space-y-2 rounded-lg border border-gray-200 p-2">
          <label className="block text-xs text-gray-600">Project ID
            <input aria-label="Project ID" className={field} value={project} onChange={(e) => setProject(e.target.value)} placeholder="e.g. PRJ-0007 — empty for none" maxLength={20} autoFocus />
          </label>
          <label className="block text-xs text-gray-600">Task ID
            <input aria-label="Task ID" className={field} value={task} onChange={(e) => setTask(e.target.value)} placeholder="e.g. T-42 — empty for none" maxLength={12} />
          </label>
          <label className="block text-xs text-gray-600">Other ID
            <input aria-label="Other ID" className={field} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. INV-2231 — empty for none" maxLength={60} />
          </label>
          <div className="flex gap-2">
            <button type="button" disabled={save.isPending} onClick={() => save.mutate()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
            </button>
            <button type="button" onClick={() => { setEditing(false); setProject(r.project?.code ?? ''); setReference(r.reference ?? ''); setTask(r.task?.code ?? ''); setError(''); }}
              className="rounded-lg px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-100">Cancel</button>
          </div>
          {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
        </dd>
      </div>
    );
  }
  return (
    <>
      <div className="grid grid-cols-[120px_1fr] gap-2 py-1 text-sm">
        <dt className="text-gray-500">Project</dt>
        <dd className="flex flex-wrap items-center gap-2 text-gray-900">
          {r.project
            ? <EntityLink type="project" id={r.project.id} value={r.project.code} label="Project ID"><span className="font-mono font-medium">{r.project.code}</span> {r.project.name}</EntityLink>
            : <span className="text-gray-500">Not linked to a project</span>}
          {may && (
            <button type="button" onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-0.5 text-xs font-medium text-blue-700 hover:bg-gray-50">
              <Link2 className="h-3 w-3" /> {r.project || r.reference || r.task ? 'Change' : 'Link project / task / other ID'}
            </button>
          )}
        </dd>
      </div>
      {r.task && (
        <div className="grid grid-cols-[120px_1fr] gap-2 py-1 text-sm">
          <dt className="text-gray-500">Task</dt>
          <dd className="break-words text-gray-900">
            <EntityLink type="task" id={r.task.id} value={r.task.code} label="Task ID">{r.task.code}{r.task.title ? ` ${r.task.title}` : ''}</EntityLink>
          </dd>
        </div>
      )}
      {r.reference && <Row k="Other ID" v={r.reference} copy="Other ID" />}
    </>
  );
}

/**
 * One payment request with everything it carries, and the buttons this person
 * may press now (`request.can`, decided by the server). Used by the team panel
 * and the admin page.
 */
export default function PaymentRequestDetail({ id, onClose, startEditing = false }: { id: string; onClose: () => void; startEditing?: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: paymentKeys.one(id), queryFn: () => getRequest(id) });
  const [note, setNote] = useState('');
  const [mode, setMode] = useState<null | 'decline' | 'hold' | 'pay' | 'edit' | 'editPayment'>(startEditing ? 'edit' : null);
  // A foreign bill only:
  //   `from` 'inr' — paid from the Indian rupee account: `rupees` is what the bank debited
  //                  (empty = an older request's estimate stands);
  //   `from` 'foreign' — paid from an account in the bill's currency (e.g. HR's Thai bank
  //                  account): `sent` is the amount sent in that currency, `account` its name.
  const [pay, setPay] = useState({ method: 'razorpay', reference: '', at: toLocalInput(), rupees: '', from: 'inr' as 'inr' | 'foreign', sent: '', account: '' });
  const [proof, setProof] = useState<File[]>([]);
  // The payment screenshot is read as it is attached; the boxes fill in to be checked.
  const slip = useSlipReader({
    files: proof,
    excludeId: id,
    onRead: (f) => {
      if (f.reference) setPay((p) => ({ ...p, reference: p.reference.trim() || f.reference }));
      if (f.transactionAt && new Date(f.transactionAt).getTime() <= Date.now()) setPay((p) => ({ ...p, at: toLocalInput(f.transactionAt) }));
    },
  });
  const [error, setError] = useState('');

  const done = (r: PaymentRequest) => {
    qc.setQueryData(paymentKeys.one(id), { request: r });
    qc.invalidateQueries({ queryKey: [...paymentKeys.all, 'list'] });
    if (r.order) qc.invalidateQueries({ queryKey: paymentKeys.forOrder(r.order.id) });
    setMode(null); setNote(''); setError(''); setProof([]);
  };
  const act = useMutation({
    mutationFn: async (a: 'approve' | 'decline' | 'hold' | 'release' | 'cancel' | 'pay') => {
      if (a !== 'pay') return (await actOn(id, a, note, q.data?.request.rev)).request;
      const form = new FormData();
      form.append('method', pay.method);
      form.append('reference', pay.reference.trim());
      form.append('transactionAt', fromLocalInput(pay.at));
      if (pay.from === 'foreign') {
        form.append('paidFrom', 'foreign');
        form.append('sentAmount', pay.sent.replace(/,/g, '').trim());
        if (pay.account.trim()) form.append('accountLabel', pay.account.trim());
      } else if (pay.rupees.trim()) form.append('rupees', pay.rupees.trim());
      if (note.trim()) form.append('note', note.trim());
      // The figures this screen shows: the server refuses if the request changed since.
      if (q.data?.request.payVersion) form.append('payVersion', q.data.request.payVersion);
      if (slip.token) form.append('slipRead', slip.token);
      for (const f of proof) form.append('proof', f);
      return (await postForm<{ request: PaymentRequest }>(`/payment-requests/${id}/pay`, form)).request;
    },
    onSuccess: done,
    onError: (e, a) => {
      setError(errorMessage(e, 'That did not work. Refresh and try again.'));
      // Changed under us: show the new figures at once, so the admin checks what they will pay.
      if (a === 'pay') qc.invalidateQueries({ queryKey: paymentKeys.one(id) });
    },
  });

  const r = q.data?.request;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <aside className="h-full w-full max-w-xl overflow-y-auto bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()} aria-label="Payment request">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold text-gray-900"><span>{r ? r.number : 'Payment request'}</span>{r?.kind === 'supplier' && <OrderTypeTag type="procurement" />}</h2>
            {r && <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[r.status]}`}>{r.statusLabel}</span>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"><X className="h-5 w-5" /></button>
        </div>

        {q.isPending && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
        {q.isError && <p role="alert" className="text-sm text-red-700">{errorMessage(q.error, 'Could not load this request.')}</p>}
        {r && (
          <div className="space-y-5">
            <div className="rounded-xl bg-gray-50 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500">{r.kind === 'supplier' ? (r.partLabel ? `Supplier payment — ${r.partLabel}` : 'Supplier payment') : r.reimbursement ? categoryName(r) : `${categoryName(r)} expense`} · {r.teamLabel}</p>
              <p className="text-2xl font-bold text-gray-900">{amountText(r)}</p>
              {r.paidFrom
                ? <p className="text-sm text-gray-700">Paid from {accountName(r.paidFrom)} — no rupees debited.</p>
                : r.rupeesPending
                ? <p className="text-sm text-gray-700">Rupee amount: what the bank debits — recorded when paid.</p>
                : foreignBill(r) && <p className="text-sm text-gray-700">Bill: {foreignBill(r)}</p>}
              <p className="text-sm text-gray-600">to {r.payee.name || 'payee not given yet'}</p>
              {r.credit && r.bill != null && <CreditSum r={r} />}
            </div>
            {r.can.credit && r.supplier && <CreditControl r={r} onSaved={done} />}
            {r.supplierRefund && (
              <SupplierRefundLine requestId={r.id} refund={r.supplierRefund} currency={r.currency || 'INR'} bill={r.bill ?? (r.currency !== 'INR' ? r.foreignAmount ?? 0 : r.amount)} />
            )}

            {r.orderCancelled && (
              <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
                This order (or the item) was cancelled, so this supplier payment cannot be paid. Decline it.
              </p>
            )}
            {r.deal && <DealSummaryBox d={r.deal} />}
            {r.bankNotice && r.status !== 'paid' && (
              <p role="status" className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                ⚠️ This supplier&apos;s bank details were changed on {formatDateTimeIST(r.bankNotice.at)} by {r.bankNotice.byName || 'someone'}. Confirm them with the supplier by phone before paying.
              </p>
            )}
            <dl>
              <Row k="Raised by" v={`${r.requestedBy} · ${formatDateTimeIST(r.createdAt)}`} />
              {r.reimbursement && (
                <Row k="Spent on" v={[formatDateIST(r.reimbursement.on), [r.reimbursement.from, r.reimbursement.to].filter(Boolean).join(' → ')].filter(Boolean).join(' · ')} />
              )}
              {r.reimbursement?.type === 'fuel' && r.reimbursement.km != null && (
                <Row k="Fuel" v={`${kmText(r.reimbursement.km)} km × ₹${kmText(r.reimbursement.ratePerKm)} per km = ${rupees(r.amount)}`} />
              )}
              {r.kind === 'expense' ? (
                <OrderLinkRow r={r} onSaved={(next, was) => {
                  // The order it left no longer lists it.
                  if (was) qc.invalidateQueries({ queryKey: paymentKeys.forOrder(was) });
                  done(next);
                }} />
              ) : r.order && (
                <div className="grid grid-cols-[120px_1fr] gap-2 py-1 text-sm">
                  <dt className="text-gray-500">Order</dt>
                  <dd className="text-gray-900"><EntityLink type="order" id={r.order.id} value={r.order.number} label="Order number" /></dd>
                </div>
              )}
              <ProjectLinkRows key={`${r.id}-${r.project?.code ?? ''}-${r.task?.code ?? ''}-${r.reference ?? ''}`} r={r} onSaved={done} />
              <Row k="Items" v={r.itemNames.join(', ')} />
              {/* A supplier payment not raised from an order (Payments → Pay a supplier). */}
              <Row k="For" v={r.kind === 'supplier' && !r.order ? (r.supplierBillId ? `Supplier bill ${r.reference || ''} (We owe suppliers)`.replace('  ', ' ') : 'Stock / not for one order') : null} />
              <Row k="Customer" v={r.customer?.name ? [r.customer.name, r.customer.phone, r.customer.alternatePhone && `Alt: ${r.customer.alternatePhone}`, r.customer.city].filter(Boolean).join(' · ') : null} />
              <Row k="Sale closed by" v={r.closedBy} />
              {r.description && (
                <div className="grid grid-cols-[120px_1fr] gap-2 py-1 text-sm">
                  <dt className="text-gray-500">Details</dt>
                  <dd className="min-w-0 text-gray-900"><RichText value={r.description} /></dd>
                </div>
              )}
              <Row k="Pay by" v={payByLine(r.payee)} />
              {r.payee.method === 'card' && <Row k="Name on card" v={r.payee.cardName} />}
              <Row k="Payee phone" v={r.payee.phone} />
              {r.payment && <Row k="Paid" v={`${paidHow(r.payment.method)}${r.payment.reference ? ` · ref ${r.payment.reference}` : ''} · by ${r.payment.paidByName}`} />}
              {r.paidFrom && <Row k="Paid from" v={`${accountName(r.paidFrom)} · ${money(r.paidFrom.amount, r.paidFrom.currency)} sent`} />}
              {r.payment && <Row k="Transaction" v={formatDateTimeIST(r.payment.transactionAt || r.payment.paidAt)} />}
              {r.payment && <Row k="Recorded" v={formatDateTimeIST(r.payment.paidAt)} />}
              {r.payment?.slipRead && <div className="sm:col-span-2"><SlipSources slipRead={r.payment.slipRead} /></div>}
              {r.decisionNote && ['declined', 'on_hold'].includes(r.status) && <Row k={r.status === 'declined' ? 'Reason' : 'On hold'} v={r.decisionNote} />}
              {r.hold && heldByText(r.hold) && <Row k="Held" v={heldByText(r.hold).replace(/^Held /, '')} />}
            </dl>

            <EditHistory edits={r.edits} />

            <div className="flex flex-wrap gap-2">
              <a href={slipHref(r.id)} target="_blank" rel="noopener noreferrer" className={`${btn} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`}>
                <FileText className="h-4 w-4 text-emerald-700" /> {r.status === 'paid' ? 'Payment receipt (PDF)' : 'Request slip (PDF)'}
              </a>
              {r.files.map((f) => {
                // With many bills or screenshots, number them within their kind: "Bill 3", "Payment screenshot 2".
                const same = r.files.filter((x) => x.kind === f.kind);
                const n = same.length > 1 ? ` ${same.indexOf(f) + 1}` : '';
                return (
                  <a key={f.id} href={fileHref(r.id, f.id)} target="_blank" rel="noopener noreferrer" title={f.name || undefined}
                    className={`${btn} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`}>
                    <Paperclip className="h-4 w-4" /> {FILE_LABELS[f.kind]}{n}{f.contentType === 'application/pdf' ? ' (PDF)' : ''}
                  </a>
                );
              })}
            </div>

            {/* Actions — only what the server says this person may do now. */}
            {(r.can.approve || r.can.decline || r.can.pay || r.can.hold || r.can.release || r.can.cancel || r.can.edit || r.can.editPayment) && (
              <div className="space-y-3 rounded-xl border border-gray-200 p-4">
                {mode === null && (
                  <div className="flex flex-wrap gap-2">
                    {r.can.editPayment && (
                      <button type="button" onClick={() => setMode('editPayment')} className={`${btn} border border-gray-300 text-gray-800 hover:bg-gray-50`}>
                        <Pencil className="h-4 w-4" /> Edit payment
                      </button>
                    )}
                    {r.can.edit && (
                      <button type="button" onClick={() => setMode('edit')} className={`${btn} border border-gray-300 text-gray-800 hover:bg-gray-50`}
                        title={r.editableUntil ? `You can edit until ${formatDateTimeIST(r.editableUntil)}` : undefined}>
                        <Pencil className="h-4 w-4" /> {r.status === 'submitted' ? 'Edit' : 'Edit & send again'}
                      </button>
                    )}
                    {r.can.approve && <button type="button" disabled={act.isPending} onClick={() => act.mutate('approve')} className={`${btn} bg-green-600 text-white hover:bg-green-700`}>Approve</button>}
                    {r.can.pay && <button type="button" onClick={() => setMode('pay')} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>Record payment</button>}
                    {r.can.hold && <button type="button" onClick={() => setMode('hold')} className={`${btn} border border-orange-300 text-orange-800 hover:bg-orange-50`}>Put on hold</button>}
                    {/* A held payment cannot be paid: releasing it is the way back to "approved". */}
                    {r.can.release && (
                      <button type="button" disabled={act.isPending}
                        onClick={() => { if (window.confirm(`Release the hold on ${r.number}? It goes back to approved, and the admin can pay it.`)) act.mutate('release'); }}
                        className={`${btn} bg-orange-600 text-white hover:bg-orange-700`}>Release hold</button>
                    )}
                    {r.can.decline && <button type="button" onClick={() => setMode('decline')} className={`${btn} border border-red-300 text-red-700 hover:bg-red-50`}>Decline</button>}
                    {r.can.cancel && (
                      <button type="button" disabled={act.isPending} onClick={() => { if (window.confirm(`Cancel ${r.number}?`)) act.mutate('cancel'); }}
                        className={`${btn} border border-gray-300 text-gray-700 hover:bg-gray-50`}>Cancel request</button>
                    )}
                  </div>
                )}
                {(mode === 'decline' || mode === 'hold') && (
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-800" htmlFor="pr-note">{mode === 'decline' ? 'Why is it declined? (the requester sees this)' : 'Why is it on hold? (e.g. funds arrive Friday)'}</label>
                    <textarea id="pr-note" className={input} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                    <div className="flex gap-2">
                      <button type="button" disabled={act.isPending} onClick={() => act.mutate(mode)} className={`${btn} ${mode === 'decline' ? 'bg-red-600 hover:bg-red-700' : 'bg-orange-600 hover:bg-orange-700'} text-white`}>
                        {mode === 'decline' ? 'Decline' : 'Put on hold'}
                      </button>
                      <button type="button" onClick={() => setMode(null)} className={`${btn} text-gray-700 hover:bg-gray-100`}>Back</button>
                    </div>
                  </div>
                )}
                {mode === 'editPayment' && (
                  <EditPaidPayment r={r} onCancel={() => setMode(null)} onDone={(next) => { setMode(null); done(next); }} />
                )}
                {mode === 'edit' && (
                  <EditPaymentRequest r={r} onCancel={() => setMode(null)} onDone={(next) => { setMode(null); done(next); }} />
                )}
                {mode === 'pay' && (
                  <div className="space-y-2">
                    {billAmount(r) ? (
                      <p className="text-sm text-gray-700">Pay <strong>{billAmount(r)}</strong> to {r.payee.name || 'the payee'}, then record it here{pay.from === 'foreign' ? '.' : ' with the rupees the bank debited.'}</p>
                    ) : (
                      <p className="text-sm text-gray-700">Pay <strong>{rupees(r.amount)}</strong> to {r.payee.name || 'the payee'} from the company Razorpay / bank, then record it here.</p>
                    )}
                    {billAmount(r) && (
                      <fieldset className="rounded-lg border border-gray-200 p-2">
                        <legend className="px-1 text-xs text-gray-600">Paid from</legend>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                          <label className="inline-flex items-center gap-1.5">
                            <input type="radio" name="paid-from" checked={pay.from === 'inr'} onChange={() => setPay({ ...pay, from: 'inr' })} /> Indian rupee account (₹)
                          </label>
                          <label className="inline-flex items-center gap-1.5">
                            <input type="radio" name="paid-from" checked={pay.from === 'foreign'} onChange={() => setPay({ ...pay, from: 'foreign', rupees: '' })} /> {r.currency} account (no rupees debited)
                          </label>
                        </div>
                      </fieldset>
                    )}
                    {billAmount(r) && pay.from === 'inr' && (
                      <label className="block text-xs text-gray-600">Rupees debited by the bank (₹){r.rupeesPending ? '' : ` — leave empty to keep the estimate of ${rupees(r.amount)}`}
                        <input aria-label="Rupees debited" className={`${input} mt-1`} required={r.rupeesPending} inputMode="decimal" pattern="\d+(\.\d{1,2})?"
                          value={pay.rupees} onChange={(e) => setPay({ ...pay, rupees: e.target.value })} placeholder="From the bank statement, e.g. 56227" />
                      </label>
                    )}
                    {billAmount(r) && pay.from === 'foreign' && (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="block text-xs text-gray-600">Amount sent ({r.currency}) — must be the bill, {billAmount(r)}
                          <input aria-label={`Amount sent in ${r.currency}`} className={`${input} mt-1`} required inputMode="decimal" pattern="[\d,]+(\.\d{1,2})?"
                            value={pay.sent} onChange={(e) => setPay({ ...pay, sent: e.target.value })} placeholder={`e.g. ${r.foreignAmount ?? ''}`} />
                        </label>
                        <label className="block text-xs text-gray-600">Which account (optional)
                          <input aria-label="Account paid from" className={`${input} mt-1`} maxLength={80}
                            value={pay.account} onChange={(e) => setPay({ ...pay, account: e.target.value })} placeholder="e.g. HR's Thailand account" />
                        </label>
                      </div>
                    )}
                    <div className="grid gap-2 sm:grid-cols-2">
                      <select aria-label="Paid by" className={input} value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>
                        <option value="razorpay">Razorpay</option>
                        <option value="bank">Bank transfer</option>
                        <option value="upi">UPI</option>
                        <option value="card">Card</option>
                        <option value="other">Other</option>
                      </select>
                      <input aria-label="Payment reference" className={input} value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} placeholder="Payout ID / UTR (optional)" />
                      <SlipFieldTag source={slip.tag('reference', pay.reference)} />
                      <label className="text-xs text-gray-600 sm:col-span-2">Transaction date &amp; time (when the money was sent)<SlipFieldTag source={slip.tag('transactionAt', pay.at)} />
                        <input type="datetime-local" aria-label="Transaction date and time" className={`${input} mt-1`} max={toLocalInput()} required value={pay.at} onChange={(e) => setPay({ ...pay, at: e.target.value })} />
                      </label>
                    </div>
                    <div className="text-sm">
                      <FilePicker files={proof} onChange={setProof} max={MAX_PROOFS} accept={PHOTO_OR_PDF}
                        label="Attach payment screenshots" icon={<Paperclip className="h-4 w-4" />} onError={setError} />
                      <SlipReadStatus slip={slip} expectedAmount={billAmount(r) ? undefined : r.amount} />
                    </div>
                    <textarea aria-label="Note" className={input} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" />
                    <div className="flex gap-2">
                      <button type="button" disabled={act.isPending} onClick={() => act.mutate('pay')} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>
                        {act.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Mark as paid
                      </button>
                      <button type="button" onClick={() => setMode(null)} className={`${btn} text-gray-700 hover:bg-gray-100`}>Back</button>
                    </div>
                  </div>
                )}
                {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
              </div>
            )}

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">History</h3>
              <ol className="space-y-2 border-l border-gray-200 pl-4">
                {r.history.map((h, i) => (
                  <li key={i} className="text-sm">
                    <p className="font-medium text-gray-900">{ACTION_LABELS[h.action] || h.action} <span className="font-normal text-gray-500">· {h.byName}</span></p>
                    <p className="text-xs text-gray-500">{formatDateTimeIST(h.at)}</p>
                    {h.note && <p className="text-xs italic text-gray-600">“{h.note}”</p>}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
