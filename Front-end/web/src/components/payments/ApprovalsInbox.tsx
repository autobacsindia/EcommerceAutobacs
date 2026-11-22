'use client';

import { useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Loader2 } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { formatDateIST } from '@/lib/datetime';
import CopyId from '@/components/ui/CopyId';
import PaymentRequestDetail from './PaymentRequestDetail';
import { EntryRow } from './SupplierCredit';
import { creditKeys, getPendingCredit } from './credit';
import { EditedTag } from './EditHistory';
import { actOn, billAmount, categoryName, errorMessage, listRequests, money, paymentKeys, type PaymentRequest } from './api';

/**
 * "Waiting for your approval" — everything procurement (and every team) raised
 * that accounts decides, across orders (owner, 2026-11-20: "procurement records
 * every supplier-related change, accounts approves or rejects it"):
 *
 *   Payments & expenses   supplier payments and expenses        → Approve / Decline (why)
 *   Supplier credit       refund claims, refunds received,
 *                         corrections                           → Approve / Decline (why)
 *   Supplier changes      "G S Enterprises → India Motor Stores" → Approve / Reject (why)
 *
 * Every list is the server's, cursor-paged; every button goes to the server, which
 * re-checks who may decide (nobody approves their own entry except the admin) and
 * refuses a stale decision. Nothing here is optimistic.
 */

export type SupplierChangeRow = {
  orderId: string; orderNumber: string; itemId: string; itemName: string; partId: string; what: string;
  from: string; to: string; reason: string; changedByName: string; changedAt: string | null;
  can: { review: boolean };
};

export const approvalKeys = {
  all: ['approvals'] as const,
  supplierChanges: () => [...approvalKeys.all, 'supplier-changes'] as const,
};

const getSupplierChanges = (after = '') =>
  apiClient.get<{ changes: SupplierChangeRow[]; nextAfter: string | null }>(`/staff/work/supplier-changes/pending${after ? `?after=${encodeURIComponent(after)}` : ''}`);
const reviewChange = (c: SupplierChangeRow, decision: 'approve' | 'reject', note = '') =>
  apiClient.post(`/staff/work/orders/${encodeURIComponent(c.orderId)}/lines/${encodeURIComponent(c.itemId)}/parts/${encodeURIComponent(c.partId)}/review`, { decision, note });

const WAITING = { status: 'submitted' };

const btn = 'rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50';
const approveBtn = `${btn} bg-green-600 text-white hover:bg-green-700`;
const rejectBtn = `${btn} border border-red-300 text-red-700 hover:bg-red-50`;
const openBtn = `${btn} border border-gray-300 text-gray-700 hover:bg-gray-50`;

function Section({ title, hint, count, children }: { title: string; hint: string; count: number | null; children: React.ReactNode }) {
  return (
    <section className="space-y-2" aria-label={title}>
      <h2 className="text-lg font-semibold text-gray-900">
        {title}{count !== null && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-sm text-amber-900">{count}</span>}
      </h2>
      <p className="text-sm text-gray-500">{hint}</p>
      {children}
    </section>
  );
}

function More({ q }: { q: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => unknown } }) {
  if (!q.hasNextPage) return null;
  return (
    <button type="button" className={openBtn} disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
      {q.isFetchingNextPage ? 'Loading…' : 'Show more'}
    </button>
  );
}

const Empty = ({ text }: { text: string }) => <p className="rounded-lg border border-dashed border-gray-300 p-3 text-sm text-gray-500">{text}</p>;
const Failed = () => <p role="alert" className="text-sm text-red-700">Could not load this list. Refresh the page to try again.</p>;
const Loading = () => <Loader2 className="h-5 w-5 animate-spin text-gray-400" aria-label="Loading" />;

/** One supplier payment / expense waiting for accounts. */
function PaymentRow({ r, onOpen }: { r: PaymentRequest; onOpen: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function act(action: 'approve' | 'decline') {
    let note = '';
    if (action === 'decline') {
      note = (window.prompt(`Why is ${r.number} declined? (the person who raised it sees this)`) || '').trim();
      if (note.length < 3) return;
    }
    setBusy(true);
    setError('');
    try {
      await actOn(r.id, action, note, r.rev);
      await qc.invalidateQueries({ queryKey: paymentKeys.all });
    } catch (e) {
      setError(errorMessage(e, 'Could not save that. Please try again.'));
    } finally {
      setBusy(false);
    }
  }
  const amount = r.rupeesPending ? billAmount(r) : money(r.amount);
  return (
    <li className="rounded-lg border border-gray-200 bg-white p-3" aria-label={`${r.number} ${amount}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 text-sm">
          <p className="font-semibold text-gray-900">
            {r.number} · {r.kind === 'supplier' ? 'Supplier payment' : categoryName(r)} · {amount}{r.payee?.name ? ` to ${r.payee.name}` : ''}
            <EditedTag r={r} />
          </p>
          <p className="text-xs text-gray-600">
            Raised by {r.requestedBy} ({r.teamLabel}) on {formatDateIST(r.createdAt)}
            {r.order?.number && <> · order {r.order.number} <CopyId value={r.order.number} label="Order number" /></>}
            {r.itemNames?.length ? ` · ${r.itemNames.join(', ')}` : ''}
          </p>
          {r.description && <p className="text-sm text-gray-700">{r.description}</p>}
          {r.orderCancelled && <p className="text-xs font-semibold text-red-700">Its order was cancelled — decline it.</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {r.can.approve && <button type="button" disabled={busy} className={approveBtn} onClick={() => act('approve')}>Approve</button>}
          {r.can.decline && <button type="button" disabled={busy} className={rejectBtn} onClick={() => act('decline')}>Decline</button>}
          <button type="button" className={openBtn} onClick={onOpen}>Open</button>
        </div>
      </div>
      {error && <p role="alert" className="mt-1 text-sm text-red-700">{error}</p>}
    </li>
  );
}

/** One supplier change waiting for accounts' review. */
function ChangeRow({ c }: { c: SupplierChangeRow }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function act(decision: 'approve' | 'reject') {
    let note = '';
    if (decision === 'reject') {
      note = (window.prompt('Why is this supplier change rejected? (procurement and the admin see this)') || '').trim();
      if (note.length < 3) return;
    }
    setBusy(true);
    setError('');
    try {
      await reviewChange(c, decision, note);
      await Promise.all([
        qc.invalidateQueries({ queryKey: approvalKeys.all }),
        // The order panel shows the review too.
        qc.invalidateQueries({ predicate: (query) => JSON.stringify(query.queryKey).includes(c.orderId) }),
      ]);
    } catch (e) {
      setError(errorMessage(e, 'Could not save that. Please try again.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="rounded-lg border border-gray-200 bg-white p-3" aria-label={`Supplier change ${c.from} to ${c.to}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 text-sm">
          <p className="flex flex-wrap items-center gap-1.5 font-semibold text-gray-900">
            <span className="line-through decoration-gray-400">{c.from || 'No supplier'}</span>
            <ArrowRight className="h-3.5 w-3.5 text-gray-500" aria-label="changed to" />
            <span>{c.to}</span>
          </p>
          <p className="text-xs text-gray-600">
            Order {c.orderNumber} <CopyId value={c.orderNumber} label="Order number" /> · {c.itemName}{c.what ? ` (${c.what})` : ''}
          </p>
          <p className="text-xs text-gray-600">
            Changed by {c.changedByName}{c.changedAt ? ` on ${formatDateIST(c.changedAt)}` : ''}
            {c.reason && <> · <span className="text-gray-800">{c.reason}</span></>}
          </p>
        </div>
        {c.can.review && (
          <div className="flex gap-2">
            <button type="button" disabled={busy} className={approveBtn} onClick={() => act('approve')}>Approve</button>
            <button type="button" disabled={busy} className={rejectBtn} onClick={() => act('reject')}>Reject</button>
          </div>
        )}
      </div>
      {error && <p role="alert" className="mt-1 text-sm text-red-700">{error}</p>}
    </li>
  );
}

export default function ApprovalsInbox() {
  const [open, setOpen] = useState<string | null>(null);
  const payments = useInfiniteQuery({
    queryKey: paymentKeys.list(WAITING),
    queryFn: ({ pageParam }) => listRequests(WAITING, pageParam || undefined),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor || undefined,
  });
  const credit = useInfiniteQuery({
    queryKey: creditKeys.pending(),
    queryFn: ({ pageParam }) => getPendingCredit(pageParam),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextAfter || undefined,
  });
  const changes = useInfiniteQuery({
    queryKey: approvalKeys.supplierChanges(),
    queryFn: ({ pageParam }) => getSupplierChanges(pageParam),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextAfter || undefined,
  });

  const paymentRows = payments.data?.pages.flatMap((p) => p.requests) ?? [];
  const creditRows = credit.data?.pages.flatMap((p) => p.entries) ?? [];
  const changeRows = changes.data?.pages.flatMap((p) => p.changes) ?? [];
  const paymentCount = payments.data?.pages[0]?.summary?.count ?? (payments.data ? paymentRows.length : null);

  return (
    <div className="space-y-8">
      <Section title="Payments & expenses" hint="Supplier payments and team expenses. Approve, and the admin pays. Decline needs a reason." count={paymentCount}>
        {payments.isLoading ? <Loading /> : payments.isError ? <Failed /> : paymentRows.length ? (
          <ul className="space-y-2">{paymentRows.map((r) => <PaymentRow key={r.id} r={r} onOpen={() => setOpen(r.id)} />)}</ul>
        ) : <Empty text="Nothing waiting." />}
        <More q={payments} />
      </Section>

      <Section title="Supplier refunds & credit" hint="“Supplier must refund” claims, money suppliers gave back, and corrections — raised by procurement." count={credit.data ? creditRows.length : null}>
        {credit.isLoading ? <Loading /> : credit.isError ? <Failed /> : creditRows.length ? (
          <ul className="space-y-2">{creditRows.map((e) => <EntryRow key={e.id} e={e} showSupplier />)}</ul>
        ) : <Empty text="Nothing waiting." />}
        <More q={credit} />
      </Section>

      <Section title="Supplier changes" hint="Procurement changed an item's supplier. The change is already in place — approve it, or reject it with a reason so procurement sorts it out." count={changes.data ? changeRows.length : null}>
        {changes.isLoading ? <Loading /> : changes.isError ? <Failed /> : changeRows.length ? (
          <ul className="space-y-2">{changeRows.map((c) => <ChangeRow key={c.partId} c={c} />)}</ul>
        ) : <Empty text="Nothing waiting." />}
        <More q={changes} />
      </Section>

      {open && <PaymentRequestDetail id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
