'use client';

/**
 * Reimbursements — one month at a glance, for the admin and Accounts: what each
 * person claimed and was paid (fuel km, food, transport, others), and what each
 * task cost. Every number is the server's (Back-end paymentRequestService
 * .reimbursementReport), by the day the money was spent; declined and cancelled
 * claims are left out.
 *
 * The admin also sets the fuel rate per km here. New claims use it; a claim
 * already raised keeps the rate it was raised with.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { formatDateTimeIST } from '@/lib/datetime';
import {
  errorMessage, getReimbursementReport, getReimbursementSettings, kmText, paymentKeys, rupees, setFuelRate,
} from './api';

const thisMonth = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7);

function FuelRate() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: paymentKeys.reimbursementSettings(), queryFn: getReimbursementSettings });
  const [editing, setEditing] = useState(false);
  const [rate, setRate] = useState('');
  const save = useMutation({
    mutationFn: () => setFuelRate(Number(rate)),
    onSuccess: () => {
      setEditing(false);
      qc.invalidateQueries({ queryKey: paymentKeys.reimbursementSettings() });
      // The expense form shows the rate: re-read it.
      qc.invalidateQueries({ queryKey: [...paymentKeys.all, 'options'] });
    },
  });
  const s = q.data?.settings;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
      <p className="font-semibold text-gray-900">Fuel rate</p>
      {!s ? (
        <p className="mt-1 text-gray-500">{q.isError ? errorMessage(q.error, 'Could not load the rate.') : 'Loading…'}</p>
      ) : editing ? (
        <form className="mt-2 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <label htmlFor="fuel-rate" className="text-gray-700">₹ per km</label>
          <input id="fuel-rate" className="w-24 rounded-lg border border-gray-300 px-2 py-1 text-sm" inputMode="decimal" pattern="\d+(\.\d{1,2})?" required value={rate} onChange={(e) => setRate(e.target.value)} autoFocus />
          <button type="submit" disabled={save.isPending} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1 text-sm font-semibold text-white disabled:opacity-50">
            {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
          </button>
          <button type="button" onClick={() => setEditing(false)} className="rounded-lg px-2 py-1 text-gray-700 hover:bg-gray-100">Cancel</button>
          {save.isError && <p role="alert" className="w-full text-xs text-red-700">{errorMessage(save.error, 'Could not save the rate.')}</p>}
        </form>
      ) : (
        <p className="mt-1 text-gray-700">
          <strong data-testid="fuel-rate">{rupees(s.fuelRatePerKm)} per km</strong>
          {s.updatedByName && <span className="text-gray-500"> · set by {s.updatedByName}{s.updatedAt ? ` on ${formatDateTimeIST(s.updatedAt)}` : ''}</span>}
          <button type="button" onClick={() => { setRate(String(s.fuelRatePerKm)); setEditing(true); }} className="ml-2 text-sm font-medium text-blue-700 hover:underline">Change</button>
        </p>
      )}
      <p className="mt-1 text-xs text-gray-500">New fuel claims use this rate. Claims already raised keep the rate they were raised with.</p>
    </div>
  );
}

export default function ReimbursementReport({ canSetRate }: { canSetRate: boolean }) {
  const [month, setMonth] = useState(thisMonth);
  const q = useQuery({
    queryKey: paymentKeys.reimbursementReport(month),
    queryFn: () => getReimbursementReport(month),
    enabled: /^\d{4}-\d{2}$/.test(month),
    staleTime: 0,
  });
  const rep = q.data?.report;
  const th = 'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500';
  const td = 'px-3 py-2 tabular-nums';
  return (
    <div className="space-y-4">
      {canSetRate && <FuelRate />}
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="rb-month" className="text-sm font-medium text-gray-700">Month spent</label>
        <input id="rb-month" type="month" className="rounded-lg border border-gray-300 px-2 py-1 text-sm" value={month} max={thisMonth()} onChange={(e) => setMonth(e.target.value)} />
      </div>
      {q.isPending ? (
        <div role="status" aria-label="Loading report" className="h-24 animate-pulse rounded-xl bg-gray-100" />
      ) : q.isError || !rep ? (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorMessage(q.error, 'Could not load the report.')}</p>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-3" aria-label="Month totals">
            <div className="rounded-lg bg-gray-50 px-3 py-2"><p className="text-lg font-semibold tabular-nums">{rupees(rep.total.amount)}</p><p className="text-xs text-gray-600">{rep.total.count} claims · {kmText(rep.total.km)} km of fuel</p></div>
            <div className="rounded-lg bg-emerald-50 px-3 py-2"><p className="text-lg font-semibold tabular-nums text-emerald-900">{rupees(rep.total.paid)}</p><p className="text-xs text-emerald-800">paid</p></div>
            <div className="rounded-lg bg-amber-50 px-3 py-2"><p className="text-lg font-semibold tabular-nums text-amber-900">{rupees(rep.total.waiting)}</p><p className="text-xs text-amber-800">not paid yet</p></div>
          </div>

          <section aria-label="Per person" className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <h3 className="px-3 pt-3 text-sm font-semibold text-gray-900">Per person</h3>
            {rep.people.length === 0 ? <p className="p-3 text-sm text-gray-500">No reimbursements spent in this month.</p> : (
              <table className="min-w-full text-sm">
                <thead><tr><th className={th}>Person</th><th className={th}>Fuel</th><th className={th}>Food</th><th className={th}>Transport</th><th className={th}>Others</th><th className={th}>Total</th><th className={th}>Paid</th></tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {rep.people.map((p) => (
                    <tr key={p.id}>
                      <td className="px-3 py-2"><span className="font-medium text-gray-900">{p.name}</span> <span className="text-xs text-gray-500">{p.teamLabel}</span></td>
                      <td className={td}>{rupees(p.byType.fuel)}{p.km > 0 && <span className="block text-xs text-gray-500">{kmText(p.km)} km</span>}</td>
                      <td className={td}>{rupees(p.byType.food)}</td>
                      <td className={td}>{rupees(p.byType.transport)}</td>
                      <td className={td}>{rupees(p.byType.other)}</td>
                      <td className={`${td} font-semibold`}>{rupees(p.amount)}<span className="block text-xs font-normal text-gray-500">{p.count} claims</span></td>
                      <td className={td}>{rupees(p.paid)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section aria-label="Per task" className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <h3 className="px-3 pt-3 text-sm font-semibold text-gray-900">Per task</h3>
            {rep.tasks.length === 0 ? <p className="p-3 text-sm text-gray-500">No claims linked to a task in this month.</p> : (
              <table className="min-w-full text-sm">
                <thead><tr><th className={th}>Task</th><th className={th}>Claims</th><th className={th}>Total</th><th className={th}>Paid</th></tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {rep.tasks.map((t) => (
                    <tr key={t.id}>
                      <td className="px-3 py-2"><span className="font-mono text-xs">{t.code}</span> {t.title}</td>
                      <td className={td}>{t.count}{t.km > 0 && <span className="block text-xs text-gray-500">{kmText(t.km)} km</span>}</td>
                      <td className={`${td} font-semibold`}>{rupees(t.amount)}</td>
                      <td className={td}>{rupees(t.paid)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          {rep.capped && <p className="text-xs text-gray-500">Showing the largest 200 people / tasks.</p>}
        </>
      )}
    </div>
  );
}
