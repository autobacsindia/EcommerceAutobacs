'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Phone, Mail, StickyNote, GitBranch, UserCheck, UserCog, Check,
  Package, XCircle, AlertTriangle, Clock, ShoppingCart, Moon, MessageCircle, Circle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  LEAD_SOURCE_LABELS, LEAD_SOURCE_COLORS, LEAD_STATUS_LABELS, LEAD_STATUS_COLORS,
  cancelAttribution, type LeadSourceType,
} from '@/lib/leads';
import type { JourneyEvent, JourneyGroup } from '@/lib/leadJourney';

const SIGNAL_ICONS: Record<LeadSourceType, LucideIcon> = {
  consultation: MessageCircle,
  payment_pending: Clock,
  payment_failed: AlertTriangle,
  payment_cancelled: XCircle,
  order_cancelled: XCircle,
  cart_abandoned: ShoppingCart,
  dormant_user: Moon,
};

const ACTIVITY_ICONS: Record<string, LucideIcon> = {
  call: Phone,
  email: Mail,
  note: StickyNote,
  sms: MessageCircle,
  status_change: GitBranch,
  claim: UserCheck,
  assignment: UserCog,
  conversion: Check,
};

function iconFor(ev: JourneyEvent): LucideIcon {
  if (ev.kind === 'order') return Package;
  if (ev.kind === 'signal') return SIGNAL_ICONS[ev.sourceType] ?? Circle;
  return ACTIVITY_ICONS[ev.activityType] ?? Circle;
}

function fmtDate(at: number) {
  return new Date(at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** One event row: icon on the rail, title + optional body, dated on the right. */
function EventRow({ ev }: { ev: JourneyEvent }) {
  const Icon = iconFor(ev);
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      <span className="z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 text-sm">{renderBody(ev)}</div>
          <time className="shrink-0 text-xs text-gray-400" title={ev.at ? new Date(ev.at).toLocaleString() : undefined}>
            {ev.at ? fmtDate(ev.at) : ''}
          </time>
        </div>
      </div>
    </li>
  );
}

function renderBody(ev: JourneyEvent) {
  if (ev.kind === 'signal') {
    const cancel = ev.sourceType === 'order_cancelled'
      ? cancelAttribution(ev.snapshot as { cancelledBy?: string | null; wasPaid?: boolean } | undefined)
      : null;
    return (
      <span className="flex flex-wrap items-center gap-1">
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${LEAD_SOURCE_COLORS[ev.sourceType]}`}>
          {LEAD_SOURCE_LABELS[ev.sourceType]}
        </span>
        {cancel?.by && <span className="text-xs text-gray-500">{cancel.by}</span>}
        {cancel?.wasPaid && (
          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">was paid</span>
        )}
      </span>
    );
  }

  if (ev.kind === 'order') {
    const cancel = ev.status === 'cancelled'
      ? cancelAttribution({ cancelledBy: ev.cancelledBy, wasPaid: ev.paymentStatus === 'paid' || ev.paymentStatus === 'refunded' })
      : null;
    return (
      <span className="flex flex-wrap items-center gap-1 text-gray-700">
        <Link href={`/admin/orders/${ev.orderId}`} className="font-medium text-blue-600 hover:underline">
          Order {ev.orderNumber || ev.orderId.slice(-6)}
        </Link>
        <span className="text-gray-500">₹{ev.total?.toLocaleString('en-IN')} · {ev.status}</span>
        {cancel?.by && <span className="text-xs text-gray-400">{cancel.by}</span>}
        {ev.paymentStatus === 'refunded' && (
          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">refunded</span>
        )}
      </span>
    );
  }

  // activity
  return (
    <div>
      <span className="capitalize text-gray-700">{ev.activityType.replace('_', ' ')}</span>
      {ev.notes && <span className="text-gray-600"> — {ev.notes}</span>}
      {ev.actor && <span className="text-xs text-gray-400"> · {ev.actor}</span>}
    </div>
  );
}

const EVENT_CAP = 12;

/** Events for one cycle, capped with a show-all toggle for long histories. */
function CycleEvents({ events }: { events: JourneyEvent[] }) {
  const [expanded, setExpanded] = useState(false);
  if (events.length === 0) return <p className="pl-9 text-sm text-gray-400">No events in this cycle.</p>;
  const shown = expanded ? events : events.slice(0, EVENT_CAP);
  const hidden = events.length - shown.length;
  return (
    <>
      {/* Vertical rail behind the icons. */}
      <ul className="relative before:absolute before:left-3 before:top-1 before:bottom-1 before:w-px before:bg-gray-200">
        {shown.map((ev, i) => <EventRow key={`${ev.kind}-${ev.at}-${i}`} ev={ev} />)}
      </ul>
      {hidden > 0 && (
        <button onClick={() => setExpanded(true)} className="pl-9 text-xs text-blue-600 hover:underline">
          Show {hidden} more
        </button>
      )}
    </>
  );
}

function CycleHeader({ group }: { group: JourneyGroup }) {
  const badge = group.outcome === 'open'
    ? { label: 'Open', className: 'bg-blue-100 text-blue-800' }
    : { label: LEAD_STATUS_LABELS[group.outcome], className: LEAD_STATUS_COLORS[group.outcome] };
  const range = [group.start, group.end].every((v) => v && Number.isFinite(v))
    ? `${fmtDate(group.start!)} → ${fmtDate(group.end!)}`
    : group.start ? `since ${fmtDate(group.start)}` : '';
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
      <span className="text-sm font-semibold text-gray-900">Cycle #{group.cycleNo}</span>
      <span className={`rounded px-2 py-0.5 text-xs font-medium ${badge.className}`}>{badge.label}</span>
      {range && <span className="text-xs text-gray-400">{range}</span>}
      {group.rep && <span className="text-xs text-gray-500">· {group.rep}</span>}
      {group.lostReason && <span className="text-xs text-gray-400">· {group.lostReason}</span>}
    </div>
  );
}

export default function JourneyTimeline({ groups }: { groups: JourneyGroup[] }) {
  const isEmpty = groups.every((g) => g.events.length === 0);
  if (isEmpty) return <p className="text-sm text-gray-400">Nothing has happened on this lead yet.</p>;

  // Headers only earn their keep once there's more than one cycle to tell apart.
  const showHeaders = groups.length > 1;
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g.cycleNo}>
          {showHeaders && <CycleHeader group={g} />}
          <CycleEvents events={g.events} />
        </div>
      ))}
    </div>
  );
}
