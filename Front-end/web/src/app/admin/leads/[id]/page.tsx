'use client';

import { Fragment, useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Phone, Mail, ShoppingBag, UserMinus, Check,
} from 'lucide-react';
import apiClient from '@/lib/api';
import OfflineOrderForm from '@/components/admin/OfflineOrderForm';
import JourneyTimeline from '@/components/admin/leads/JourneyTimeline';
import { buildJourney } from '@/lib/leadJourney';
import {
  Lead, LeadStatus, LEAD_STATUS_LABELS, LEAD_STATUS_COLORS,
  LEAD_SOURCE_LABELS, LEAD_SOURCE_COLORS, customerBadge, VIP_MIN_SPENT_PAISE, SalesRep,
  cancelAttribution, type OrderHistoryItem,
} from '@/lib/leads';

interface LeadDetailResponse {
  success: boolean;
  lead: Lead;
  orderHistory: OrderHistoryItem[];
}

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [lead, setLead] = useState<Lead | null>(null);
  const [orderHistory, setOrderHistory] = useState<OrderHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [reps, setReps] = useState<SalesRep[]>([]);

  // activity form
  const [activityType, setActivityType] = useState<'call' | 'note' | 'email'>('call');
  const [activityNotes, setActivityNotes] = useState('');

  // Merged cycle-grouped timeline (activities + signals + orders).
  const journey = useMemo(
    () => (lead ? buildJourney(lead, orderHistory) : []),
    [lead, orderHistory],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<LeadDetailResponse>(`/leads/${id}`);
      if (res.success) { setLead(res.lead); setOrderHistory(res.orderHistory || []); }
    } catch (e) {
      console.error('[Lead] load failed', e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    apiClient.get<{ success: boolean; reps: SalesRep[] }>('/leads/reps')
      .then((r) => { if (r.success) setReps(r.reps); })
      .catch((e) => console.error('[Lead] reps failed', e));
  }, []);

  // Set the named owner: release when blank, atomic claim from the pool, else reassign.
  async function setOwner(repId: string) {
    setSaving(true);
    try {
      if (!repId) {
        await apiClient.post(`/leads/${id}/release`, {});
      } else if (!lead?.assignedRep) {
        await apiClient.post(`/leads/${id}/claim`, { repId });
      } else {
        await apiClient.post(`/leads/${id}/assign`, { repId });
      }
      await load();
    } catch (e) {
      console.error('[Lead] set owner failed', e);
      alert('Could not update owner — it may have just been claimed by another rep.');
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(next: LeadStatus) {
    setSaving(true);
    try {
      // Credit the current owner (if any) with the change.
      await apiClient.patch(`/leads/${id}/status`, { status: next, repId: lead?.assignedRep?._id });
      await load();
    } catch (e) {
      console.error('[Lead] status failed', e);
    } finally {
      setSaving(false);
    }
  }

  async function logActivity() {
    if (!activityNotes.trim()) return;
    setSaving(true);
    try {
      await apiClient.post(`/leads/${id}/activity`, { type: activityType, notes: activityNotes.trim(), repId: lead?.assignedRep?._id });
      setActivityNotes('');
      await load();
    } catch (e) {
      console.error('[Lead] activity failed', e);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-10 text-center text-gray-400">Loading…</div>;
  if (!lead) return <div className="p-10 text-center text-gray-400">Lead not found.</div>;

  return (
    <div className="space-y-6">
      <Link href="/admin/leads" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
        <ArrowLeft className="h-4 w-4" /> Back to leads
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-gray-200 bg-white p-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-gray-900">{lead.name || 'Unknown lead'}</h1>
            {(() => {
              const badge = customerBadge(lead);
              return badge ? (
                <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${badge.className}`}>
                  <ShoppingBag className="h-3 w-3" /> {badge.label}
                </span>
              ) : null;
            })()}
            {(lead.linkedUser?.totalSpentPaise ?? 0) >= VIP_MIN_SPENT_PAISE && (
              <span className="inline-flex items-center rounded bg-yellow-100 px-2 py-0.5 text-xs font-semibold text-yellow-800">
                ★ VIP
              </span>
            )}
            {(lead.reopenCount ?? 0) > 0 && (
              <span className="text-xs text-gray-400">Cycle #{(lead.reopenCount ?? 0) + 1}</span>
            )}
          </div>
          <div className="mt-2 flex flex-col gap-1 text-sm text-gray-600">
            {lead.email && <span className="flex items-center gap-1"><Mail className="h-4 w-4" />{lead.email}</span>}
            {lead.phone && <span className="flex items-center gap-1"><Phone className="h-4 w-4" />{lead.phone}</span>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className={`rounded px-2 py-1 text-xs font-medium ${LEAD_STATUS_COLORS[lead.status]}`}>
            {LEAD_STATUS_LABELS[lead.status]}
          </span>
          <span className="text-xs text-gray-500">
            {lead.assignedRep ? `Owner: ${lead.assignedRep.name}` : 'Unclaimed (pool)'}
          </span>
          <div className="flex items-center gap-2">
            {/* Owner = named rep. Pick to claim/reassign; blank to release. */}
            <select
              value={lead.assignedRep?._id || ''}
              onChange={(e) => setOwner(e.target.value)}
              disabled={saving}
              className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 disabled:opacity-50"
              title="Assign to a sales rep"
            >
              <option value="">— pool —</option>
              {lead.assignedRep && !reps.some((r) => r._id === lead.assignedRep!._id) && (
                <option value={lead.assignedRep._id}>{lead.assignedRep.name} (inactive)</option>
              )}
              {reps.map((r) => (
                <option key={r._id} value={r._id}>{r.name}</option>
              ))}
            </select>
            {lead.assignedRep && (
              <button
                onClick={() => setOwner('')}
                disabled={saving}
                className="flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                <UserMinus className="h-3 w-3" /> Release
              </button>
            )}
            <Link href="/admin/sales-reps" className="text-xs text-blue-600 hover:underline" title="Manage rep names">
              Manage
            </Link>
          </div>
        </div>
      </div>

      {/* Pipeline roadmap — the whole lifecycle at a glance */}
      <StatusPipeline lead={lead} saving={saving} onChange={changeStatus} />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: actions */}
        <div className="space-y-6 lg:col-span-2">
          {/* Log contact */}
          <section className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">Log a contact</h2>
            <div className="flex gap-2">
              <select value={activityType} onChange={(e) => setActivityType(e.target.value as 'call' | 'note' | 'email')} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
                <option value="call">Call</option>
                <option value="email">Email</option>
                <option value="note">Note</option>
              </select>
              <input
                value={activityNotes}
                onChange={(e) => setActivityNotes(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') logActivity(); }}
                placeholder="What happened?"
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <button onClick={logActivity} disabled={saving || !activityNotes.trim()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                Log
              </button>
            </div>
            <p className="mt-2 text-xs text-gray-400">Logging a call/email marks the lead as contacted.</p>
          </section>

          {/* Close deal */}
          <CloseDealForm lead={lead} reps={reps} onClosed={load} />
        </div>

        {/* Right: at a glance — what's open now + lifetime value */}
        <div className="space-y-6">
          <section className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">Open signals</h2>
            {lead.sources.length === 0 ? (
              <p className="text-sm text-gray-400">No active signals.</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {lead.sources.map((s, i) => {
                  // Cancelled-order signals carry who cancelled + whether it was paid.
                  const cancel = s.type === 'order_cancelled'
                    ? cancelAttribution(s.snapshot as { cancelledBy?: string | null; wasPaid?: boolean } | undefined)
                    : null;
                  return (
                    <li key={i} className="flex items-center gap-1">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${LEAD_SOURCE_COLORS[s.type]}`}>{LEAD_SOURCE_LABELS[s.type]}</span>
                      {cancel?.by && <span className="text-xs text-gray-500">{cancel.by}</span>}
                      {cancel?.wasPaid && (
                        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">was paid</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-2 text-xs text-gray-400">The full history is in the Journey below.</p>
          </section>

          {lead.linkedUser && (lead.linkedUser.paidOrderCount ?? 0) > 0 && (
            <section className="rounded-lg border border-gray-200 bg-white p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-900">Customer value</h2>
                <Link href={`/admin/users?search=${encodeURIComponent(lead.linkedUser.email || lead.linkedUser.phone || '')}`} className="text-xs text-blue-600 hover:underline">
                  View account
                </Link>
              </div>
              <dl className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="text-gray-500">Total spent</dt>
                  <dd className="font-semibold text-gray-900">
                    ₹{((lead.linkedUser.totalSpentPaise ?? 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-gray-500">Paid orders</dt>
                  <dd className="text-gray-700">{lead.linkedUser.paidOrderCount ?? 0}</dd>
                </div>
                {lead.linkedUser.firstPurchaseAt && (
                  <div className="flex items-center justify-between">
                    <dt className="text-gray-500">First order</dt>
                    <dd className="text-gray-700">{new Date(lead.linkedUser.firstPurchaseAt).toLocaleDateString()}</dd>
                  </div>
                )}
                {lead.linkedUser.lastOrderAt && (
                  <div className="flex items-center justify-between">
                    <dt className="text-gray-500">Last order</dt>
                    <dd className="text-gray-700">{new Date(lead.linkedUser.lastOrderAt).toLocaleDateString()}</dd>
                  </div>
                )}
              </dl>
            </section>
          )}

        </div>
      </div>

      {/* Journey — activities, signals and orders as one cycle-grouped rail */}
      <section className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="mb-4 text-sm font-semibold text-gray-900">Journey</h2>
        <JourneyTimeline groups={journey} />
      </section>
    </div>
  );
}

// Manual status rules, mirrored from the API: forward-only through the active
// stages; won/lost are terminal (only a new customer signal reopens them); won
// is order-backed, never set by hand.
const PROGRESSION: LeadStatus[] = ['new', 'contacted', 'qualified'];
const STATUS_RANK: Record<string, number> = { new: 0, contacted: 1, qualified: 2 };

/**
 * The lead lifecycle as a left-to-right roadmap: New → Contacted → Qualified →
 * outcome. Stages advance forward-only; Won lands automatically on an order and
 * is never clickable; Lost is a manual close via the button below the rail.
 */
function StatusPipeline({ lead, saving, onChange }: {
  lead: Lead; saving: boolean; onChange: (s: LeadStatus) => void;
}) {
  const isWon = lead.status === 'won';
  const isLost = lead.status === 'lost';
  const terminal = isWon || isLost;
  const currentRank = STATUS_RANK[lead.status] ?? -1;

  // Why a stage can't be clicked (null = allowed). Same rules as the API.
  const lockReason = (s: LeadStatus): string | null => {
    if (lead.status === s) return null;
    if (s === 'won') return 'Set automatically when an order is placed or an offline order is created';
    if (terminal) return 'This lead is closed — a new signal from the customer reopens it';
    if (s !== 'lost' && STATUS_RANK[s] <= currentRank) return 'Leads move forward only';
    return null;
  };

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="mb-4 text-sm font-semibold text-gray-900">Pipeline</h2>
      {/* Nodes are shrink-0; connectors flex-1 so stages spread evenly. */}
      <div className="flex items-center overflow-x-auto">
        {PROGRESSION.map((s, i) => {
          const rank = STATUS_RANK[s];
          const done = isWon || (!isLost && rank < currentRank);
          const current = lead.status === s;
          const clickable = !saving && !current && lockReason(s) === null;
          const passed = isWon || rank < currentRank; // connector leaving this node
          return (
            <Fragment key={s}>
              <button
                onClick={() => clickable && onChange(s)}
                disabled={!clickable}
                title={lockReason(s) || undefined}
                className={`flex shrink-0 items-center gap-2 rounded-full py-1 pl-1 pr-3 text-xs font-medium transition ${
                  current ? 'bg-blue-50 ring-2 ring-blue-400' : ''
                } ${clickable ? 'cursor-pointer hover:bg-gray-100' : 'cursor-default'}`}
              >
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] ${
                    done ? 'bg-green-600 text-white'
                      : current ? 'bg-blue-600 text-white'
                      : isLost ? 'bg-gray-200 text-gray-400'
                      : 'border border-gray-300 text-gray-400'
                  }`}
                >
                  {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span className={current ? 'text-blue-800' : done ? 'text-gray-700' : 'text-gray-400'}>
                  {LEAD_STATUS_LABELS[s]}
                </span>
              </button>
              <div className={`mx-1 h-0.5 min-w-4 flex-1 ${passed ? 'bg-green-500' : 'bg-gray-200'}`} />
            </Fragment>
          );
        })}
        {/* Outcome node */}
        <div
          title={terminal ? undefined : 'Set automatically when an order is placed'}
          className={`flex shrink-0 items-center gap-2 rounded-full py-1 pl-1 pr-3 text-xs font-medium ${
            isWon ? 'bg-green-50' : isLost ? 'bg-gray-100' : ''
          }`}
        >
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] ${
              isWon ? 'bg-green-600 text-white'
                : isLost ? 'bg-gray-400 text-white'
                : 'border border-dashed border-gray-300 text-gray-400'
            }`}
          >
            {isWon ? <Check className="h-3.5 w-3.5" /> : isLost ? '×' : '★'}
          </span>
          <span className={isWon ? 'text-green-800' : isLost ? 'text-gray-600' : 'text-gray-400'}>
            {isWon ? 'Won' : isLost ? 'Lost' : 'Outcome'}
          </span>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <p className="text-xs text-gray-400">
          {terminal
            ? 'This lead is closed and locked. A new signal from the customer reopens it automatically.'
            : 'Stages move forward only. Won is set automatically by a paid or offline order — never by hand.'}
        </p>
        {!terminal && (
          <button
            onClick={() => onChange('lost')}
            disabled={saving}
            className="shrink-0 rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            Mark as lost
          </button>
        )}
      </div>
      {lead.sources.some((s) => s.type === 'consultation') && (
        <p className="mt-1 text-xs text-gray-400">Status changes mirror to the linked consultancy record.</p>
      )}
    </section>
  );
}

/** Close a deal by creating an offline order for this lead's customer. */
function CloseDealForm({ lead, reps, onClosed }: { lead: Lead; reps: SalesRep[]; onClosed: () => void }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<{ ref: string; link?: string | null } | null>(null);

  if (lead.status === 'won' && !open) {
    return (
      <section className="rounded-lg border border-green-200 bg-green-50 p-5 text-sm text-green-800">
        <Check className="mr-1 inline h-4 w-4" /> This deal is won.
        {lead.convertedOrder && (
          <Link href={`/admin/orders/${lead.convertedOrder._id}`} className="ml-2 underline">View order</Link>
        )}
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">Close deal → offline order</h2>
        {!open && (
          <button
            onClick={() => setOpen(true)}
            className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700"
          >
            Create offline order
          </button>
        )}
      </div>

      {done && (
        <div className="mt-3 rounded bg-green-50 p-2 text-sm text-green-700">
          {done.link ? (
            <>Payment link sent for order {done.ref}. It becomes a confirmed order — and this lead turns Won — once the customer pays. <a href={done.link} target="_blank" rel="noreferrer" className="underline">Open link</a></>
          ) : (
            <>Offline order {done.ref} created. The customer will get an invoice + set-password link.</>
          )}
        </div>
      )}

      {open && (
        <div className="mt-4">
          <OfflineOrderForm
            reps={reps}
            leadId={lead._id}
            defaults={{ name: lead.name, email: lead.email || '', phone: lead.phone || '', repId: lead.assignedRep?._id }}
            submitLabel="Create order & close"
            onCreated={(ref, paymentLink) => { setDone({ ref, link: paymentLink?.shortUrl }); setOpen(false); onClosed(); }}
            onCancel={() => setOpen(false)}
          />
        </div>
      )}
    </section>
  );
}
