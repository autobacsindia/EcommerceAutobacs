'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import RichText from '@/components/ui/RichText';
import { quietButton } from '@/components/training/types';
import { usePastMember, usePastMemberOrders, usePastMemberTasks } from './hooks';
import {
  MOVE_KIND_LABEL, dateLabel, orderStatusLabel, rupees, timeOnTeam, trainingStatusLabel, type PastMemberProfile, type PastMemberSales,
} from './types';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="mb-3 font-semibold text-gray-900">{title}</h2>
      {children}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-sm font-medium text-gray-900">{value}</dd>
    </div>
  );
}

const None = ({ children }: { children: ReactNode }) => <p className="text-sm text-gray-600">{children}</p>;

function MoreButton({ more, loading, onClick }: { more: boolean; loading: boolean; onClick: () => void }) {
  if (!more) return null;
  return <button type="button" className={`${quietButton} mt-3`} disabled={loading} onClick={onClick}>{loading ? 'Loading…' : 'Show more'}</button>;
}

function Sales({ id, s }: { id: string; s: PastMemberSales }) {
  const orders = usePastMemberOrders(id, true);
  const rows = orders.data?.pages.flatMap((p) => p.orders) ?? [];
  return (
    <Section title="Sales">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Fact label="Paid orders" value={s.orders.paid} />
        <Fact label="Value of paid orders" value={rupees(s.orders.paidValue)} />
        <Fact label="Returned / cancelled" value={`${s.orders.returned} / ${s.orders.cancelled}`} />
        <Fact label="Never paid" value={s.orders.notPaid} />
        <Fact label="Quotations sent" value={s.quotations.sent} />
        <Fact label="Quotations accepted" value={s.quotations.accepted} />
        <Fact label="Leads won" value={s.leads.won} />
        <Fact label="Leads lost" value={s.leads.lost} />
      </dl>
      <h3 className="mb-2 mt-4 text-sm font-semibold text-gray-800">Their orders</h3>
      {orders.isError && <None>Orders could not be loaded.</None>}
      {orders.isSuccess && !rows.length && <None>No orders.</None>}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-gray-500"><tr><th className="py-1 pr-3 font-medium">Order</th><th className="py-1 pr-3 font-medium">Date</th><th className="py-1 pr-3 font-medium">Amount</th><th className="py-1 font-medium">Status</th></tr></thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id} className="border-t border-gray-100">
                  <td className="py-1.5 pr-3 font-mono text-xs">{o.number}</td>
                  <td className="py-1.5 pr-3">{dateLabel(o.createdAt)}</td>
                  <td className="py-1.5 pr-3">{rupees(o.totalAmount)}</td>
                  <td className="py-1.5">{orderStatusLabel(o.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <MoreButton more={!!orders.hasNextPage} loading={orders.isFetchingNextPage} onClick={() => void orders.fetchNextPage()} />
    </Section>
  );
}

function Tasks({ id, count }: { id: string; count: number }) {
  const tasks = usePastMemberTasks(id, count > 0);
  const rows = tasks.data?.pages.flatMap((p) => p.tasks) ?? [];
  return (
    <Section title={`Tasks finished (${count})`}>
      {count === 0 && <None>No finished tasks.</None>}
      {tasks.isError && <None>Tasks could not be loaded.</None>}
      {rows.length > 0 && (
        <ul className="divide-y divide-gray-100 text-sm">
          {rows.map((t) => (
            <li key={t.id} className="flex justify-between gap-3 py-1.5">
              <span className="text-gray-900">{t.title}</span>
              <span className="shrink-0 text-gray-500">{dateLabel(t.completedAt)}</span>
            </li>
          ))}
        </ul>
      )}
      <MoreButton more={!!tasks.hasNextPage} loading={tasks.isFetchingNextPage} onClick={() => void tasks.fetchNextPage()} />
    </Section>
  );
}

function Handover({ h }: { h: NonNullable<PastMemberProfile['handover']> }) {
  return (
    <Section title="Handover">
      {h.note ? (
        <>
          <RichText value={h.note} className="text-sm" />
          {h.noteByName && <p className="mt-2 text-xs text-gray-500">Written by {h.noteByName}{h.noteAt ? `, ${dateLabel(h.noteAt)}` : ''}</p>}
        </>
      ) : <None>No handover note was written.</None>}
      {h.moved.length > 0 && (
        <>
          <h3 className="mb-2 mt-4 text-sm font-semibold text-gray-800">Work passed on</h3>
          <ul className="divide-y divide-gray-100 text-sm">
            {h.moved.map((x, i) => (
              <li key={`${x.kind}-${i}`} className="flex justify-between gap-3 py-1.5">
                <span className="text-gray-900">{MOVE_KIND_LABEL[x.kind]}: {x.label}</span>
                <span className="shrink-0 text-gray-500">to {x.toName}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}

export default function PastMemberProfileView({ id, base }: { id: string; base: string }) {
  const q = usePastMember(id);
  const lessonsBase = base.replace(/past-members$/, 'lessons');
  const back = <Link href={base} className="mb-4 inline-flex items-center gap-1 text-sm text-blue-700 hover:underline"><ArrowLeft aria-hidden className="h-4 w-4" />Past members</Link>;
  if (q.isLoading) return <div className="max-w-4xl">{back}<p className="text-sm text-gray-600">Loading…</p></div>;
  if (q.isError || !q.data) {
    return <div className="max-w-4xl">{back}<p className="text-sm text-gray-700">This person could not be found, or is not on your team.</p></div>;
  }
  const m = q.data;
  return (
    <div className="max-w-4xl space-y-4">
      {back}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{m.name || 'Name not saved'}</h1>
        <p className="mt-1 text-sm text-gray-600">{m.teamLabel} · {m.roleLabel} · No longer on the team</p>
      </div>
      <Section title="Summary">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Fact label="Joined" value={m.joinedOn ? dateLabel(`${m.joinedOn}T12:00:00Z`) : 'Not known'} />
          <Fact label="Last day" value={m.lastDay ? dateLabel(`${m.lastDay}T12:00:00Z`) : 'Not known'} />
          <Fact label="Time on the team" value={timeOnTeam(m.daysOnTeam)} />
          <Fact label="Taken over by" value={m.takenOverBy || 'Not recorded'} />
        </dl>
      </Section>
      {m.sales && <Sales id={m.id} s={m.sales} />}
      <Tasks id={m.id} count={m.tasksDone} />
      <Section title="Training">
        {m.training.length ? (
          <ul className="divide-y divide-gray-100 text-sm">
            {m.training.map((t) => (
              <li key={t.id} className="flex justify-between gap-3 py-1.5">
                <span className="text-gray-900">{t.title}</span>
                <span className="shrink-0 text-gray-500">
                  {trainingStatusLabel(t.status)}{t.status === 'signed_off' && t.signedOffAt ? ` ${dateLabel(t.signedOffAt)}${t.signedOffByName ? ` by ${t.signedOffByName}` : ''}` : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : <None>No training was assigned.</None>}
      </Section>
      <Section title="Lessons they wrote">
        {m.lessons.length ? (
          <ul className="divide-y divide-gray-100 text-sm">
            {m.lessons.map((l) => (
              <li key={l.id} className="py-1.5"><Link href={`${lessonsBase}/${l.id}`} className="text-blue-700 hover:underline">{l.title}</Link></li>
            ))}
          </ul>
        ) : <None>No lessons.</None>}
      </Section>
      {m.handover ? <Handover h={m.handover} /> : <Section title="Handover"><None>No resignation was recorded for this person.</None></Section>}
    </div>
  );
}
