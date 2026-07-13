'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Phone, Mail, ShoppingBag, UserMinus, Check,
} from 'lucide-react';
import apiClient from '@/lib/api';
import OfflineOrderForm from '@/components/admin/OfflineOrderForm';
import {
  Lead, LeadStatus, LEAD_STATUSES, LEAD_STATUS_LABELS, LEAD_STATUS_COLORS,
  LEAD_SOURCE_LABELS, LEAD_SOURCE_COLORS, customerBadge, VIP_MIN_SPENT_PAISE, SalesRep,
} from '@/lib/leads';

interface OrderHistoryItem {
  _id: string;
  orderNumber?: string;
  totalAmount: number;
  status: string;
  createdAt: string;
}
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

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: status + activity + close deal */}
        <div className="space-y-6 lg:col-span-2">
          {/* Status control */}
          <section className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">Status</h2>
            <div className="flex flex-wrap gap-2">
              {(() => {
                // Manual status rules, mirrored from the API: forward-only through
                // the active stages; won/lost are terminal (only a new customer
                // signal reopens them); won is order-backed, never set by hand.
                const RANK: Record<string, number> = { new: 0, contacted: 1, qualified: 2 };
                const terminal = lead.status === 'won' || lead.status === 'lost';
                return LEAD_STATUSES.map((s) => {
                  const isCurrent = lead.status === s;
                  let locked = false;
                  let reason: string | undefined;
                  if (isCurrent) {
                    locked = true;
                  } else if (s === 'won') {
                    locked = true; reason = 'Set automatically when an order is placed or an offline order is created';
                  } else if (terminal) {
                    locked = true; reason = 'This lead is closed — a new signal from the customer reopens it';
                  } else if (s !== 'lost' && RANK[s] <= RANK[lead.status]) {
                    locked = true; reason = 'Leads move forward only';
                  }
                  return (
                    <button
                      key={s}
                      onClick={() => changeStatus(s)}
                      disabled={saving || locked}
                      title={reason}
                      className={`rounded-full px-3 py-1 text-xs font-medium ${
                        isCurrent ? LEAD_STATUS_COLORS[s] + ' ring-2 ring-offset-1 ring-blue-400' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      } disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      {LEAD_STATUS_LABELS[s]}
                    </button>
                  );
                });
              })()}
            </div>
            <p className="mt-2 text-xs text-gray-400">
              {lead.status === 'won' || lead.status === 'lost'
                ? 'This lead is closed and locked. If the customer comes back, a new signal reopens it automatically.'
                : 'Leads move forward only. Won is set automatically by a paid online order or an offline order — never by hand.'}
            </p>
            {lead.sources.some((s) => s.type === 'consultation') && (
              <p className="mt-1 text-xs text-gray-400">Status changes mirror to the linked consultancy record.</p>
            )}
          </section>

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

          {/* Activity timeline */}
          <section className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">Activity</h2>
            {lead.activities.length === 0 ? (
              <p className="text-sm text-gray-400">No activity yet.</p>
            ) : (
              <ul className="space-y-3">
                {[...lead.activities].reverse().map((a, i) => (
                  <li key={a._id || i} className="flex gap-3 text-sm">
                    <span className="mt-0.5 rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 capitalize">{a.type.replace('_', ' ')}</span>
                    <div>
                      <p className="text-gray-700">{a.notes}</p>
                      <p className="text-xs text-gray-400">
                        {new Date(a.at).toLocaleString()}
                        {a.rep && typeof a.rep === 'object' && a.rep.name
                          ? ` · ${a.rep.name}`
                          : a.by && typeof a.by === 'object' && a.by.name ? ` · ${a.by.name}` : ''}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Right: sources + order history */}
        <div className="space-y-6">
          <section className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">Signals</h2>
            <ul className="space-y-2">
              {lead.sources.map((s, i) => (
                <li key={i} className="flex items-center justify-between">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${LEAD_SOURCE_COLORS[s.type]}`}>{LEAD_SOURCE_LABELS[s.type]}</span>
                  {s.capturedAt && <span className="text-xs text-gray-400">{new Date(s.capturedAt).toLocaleDateString()}</span>}
                </li>
              ))}
              {lead.sources.length === 0 && <li className="text-sm text-gray-400">No active signals.</li>}
            </ul>
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

          <section className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">Order history</h2>
            {orderHistory.length === 0 ? (
              <p className="text-sm text-gray-400">No orders on this account.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {orderHistory.map((o) => (
                  <li key={o._id} className="flex items-center justify-between">
                    <Link href={`/admin/orders/${o._id}`} className="text-blue-600 hover:underline">{o.orderNumber || o._id.slice(-6)}</Link>
                    <span className="text-gray-500">₹{o.totalAmount?.toLocaleString()} · {o.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {(lead.cycles?.length ?? 0) > 0 && (
            <section className="rounded-lg border border-gray-200 bg-white p-5">
              <h2 className="mb-3 text-sm font-semibold text-gray-900">Previous cycles</h2>
              <ul className="space-y-3 text-sm">
                {lead.cycles!.map((c, i) => (
                  <li key={i} className="border-l-2 border-gray-200 pl-3">
                    <div className="flex items-center gap-2">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${c.outcome ? LEAD_STATUS_COLORS[c.outcome] : 'bg-gray-100 text-gray-600'}`}>
                        {c.outcome ? LEAD_STATUS_LABELS[c.outcome] : '—'}
                      </span>
                      {c.primarySource && (
                        <span className="text-xs text-gray-500">{LEAD_SOURCE_LABELS[c.primarySource]}</span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-gray-400">
                      {c.startedAt ? new Date(c.startedAt).toLocaleDateString() : '?'}
                      {' → '}
                      {c.closedAt ? new Date(c.closedAt).toLocaleDateString() : '?'}
                      {c.lostReason ? ` · ${c.lostReason}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
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
