'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, Circle, Pencil } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hrApi } from '@/lib/hr/api';
import { hrKeys } from '@/lib/hr/keys';
import { describeHrError } from '@/lib/hr/errors';
import { dayLabel, halfDaysNumber } from '@/lib/hr/format';
import type { Employee, EmployeeInput } from '@/lib/hr/types';
import EmployeeForm from './EmployeeForm';
import SalaryPanel from './SalaryPanel';
import StatusChip from './StatusChip';
import Initials from './Initials';
import { STATUS_CHIP, teamLabel } from './EmployeesList';
import { HrErrorState, HrLoading, hrBtnGhost, hrCard } from './HrStates';

const last4 = (v: string | undefined) => (v ? `•••• ${v}` : 'Not added');

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-gray-100 py-2 text-sm last:border-0">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-right font-medium text-gray-900">{value || '—'}</dd>
    </div>
  );
}

export function OnboardingChecklist({ employee }: { employee: Employee }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const toggle = useMutation({
    mutationFn: ({ key, done }: { key: string; done: boolean }) => hrApi.setOnboardingItem(employee.id, key, done),
    onSuccess: ({ employee: updated }) => {
      setError(null);
      qc.setQueryData(hrKeys.employee(employee.id), { employee: updated });
      qc.invalidateQueries({ queryKey: hrKeys.employees() });
    },
    onError: (err) => setError(describeHrError(err).message),
  });
  const items = employee.onboarding;
  const done = items.filter((i) => i.done).length;
  const readOnly = employee.status === 'exited';

  return (
    <section className={`${hrCard} p-4`} aria-labelledby="hr-onboarding">
      <div className="mb-2 flex items-center justify-between">
        <h2 id="hr-onboarding" className="font-bold text-gray-900">Onboarding</h2>
        <StatusChip tone={done === items.length ? 'ok' : 'warn'}>{done === items.length ? 'Done' : `${done} of ${items.length} done`}</StatusChip>
      </div>
      {!items.length ? <p className="text-sm text-gray-500">No checklist for this person.</p> : (
        <ul className="space-y-1">
          {items.map((i) => {
            const busy = toggle.isPending && toggle.variables?.key === i.key;
            return (
              <li key={i.key}>
                <button
                  type="button"
                  disabled={readOnly || toggle.isPending}
                  onClick={() => toggle.mutate({ key: i.key, done: !i.done })}
                  aria-pressed={i.done}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-gray-50 disabled:cursor-default"
                >
                  {i.done ? <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden="true" /> : <Circle className="h-5 w-5 text-gray-300" aria-hidden="true" />}
                  <span className={i.done ? 'text-gray-900' : 'text-gray-600'}>{i.label}</span>
                  {busy && <span className="ml-auto text-xs text-gray-400">Saving…</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </section>
  );
}

function LeaveBalances({ employeeId }: { employeeId: string }) {
  const year = new Date().getFullYear();
  const q = useQuery({ queryKey: hrKeys.balances(employeeId, year), queryFn: () => hrApi.employeeBalances(employeeId, year), retry: false });
  return (
    <section className={`${hrCard} p-4`} aria-labelledby="hr-balances">
      <h2 id="hr-balances" className="mb-2 font-bold text-gray-900">Leave left in {year}</h2>
      {q.isPending ? <HrLoading /> : q.isError ? <HrErrorState error={q.error} /> : !q.data.items.length ? (
        <p className="text-sm text-gray-500">No leave types set up yet.</p>
      ) : (
        <ul className="grid grid-cols-3 gap-2">
          {q.data.items.map((b) => (
            <li key={b.leaveType.id} className="rounded-lg bg-gray-50 p-3 text-center">
              <p className="text-xl font-bold text-gray-900">{halfDaysNumber(b.available)}</p>
              <p className="text-xs text-gray-500">{b.leaveType.name}</p>
              {b.pending > 0 && <p className="text-[11px] text-amber-700">{halfDaysNumber(b.pending)} waiting</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function EmployeeDetail({ id }: { id: string }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const q = useQuery({ queryKey: hrKeys.employee(id), queryFn: () => hrApi.getEmployee(id), retry: false });

  const save = async (input: EmployeeInput) => {
    if (!q.data) return;
    const { employee } = await hrApi.updateEmployee(id, q.data.employee.rev, input);
    qc.setQueryData(hrKeys.employee(id), { employee });
    qc.invalidateQueries({ queryKey: hrKeys.employees() });
    setEditing(false);
  };

  const back = <Link href="/hr/employees" className="mb-3 inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> All employees</Link>;
  if (q.isPending) return <div className="max-w-5xl">{back}<HrLoading /></div>;
  if (q.isError) return <div className="max-w-5xl">{back}<HrErrorState error={q.error} onRetry={() => q.refetch()} /></div>;
  const e = q.data.employee;
  const chip = STATUS_CHIP[e.status];

  return (
    <div className="max-w-5xl">
      {back}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Initials name={e.name} />
          <div>
            <h1 className="text-xl font-bold text-gray-900">{e.name}</h1>
            <p className="text-sm text-gray-500">{[e.designation, teamLabel(e.team), e.employeeCode].filter(Boolean).join(' · ')}</p>
          </div>
          <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
        </div>
        {!editing && e.status !== 'exited' && (
          <button type="button" className={hrBtnGhost} onClick={() => setEditing(true)}><Pencil className="h-4 w-4" aria-hidden="true" /> Edit</button>
        )}
      </div>

      {editing ? (
        <div className={`${hrCard} p-4`}>
          <EmployeeForm employee={e} submitLabel="Save changes" onSubmit={save} onCancel={() => setEditing(false)} />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className={`${hrCard} p-4`} aria-labelledby="hr-profile">
            <h2 id="hr-profile" className="mb-1 font-bold text-gray-900">Profile</h2>
            <dl>
              <Row label="Joined" value={dayLabel(e.joinDate)} />
              <Row label="Phone" value={e.phone} />
              <Row label="Work email" value={e.workEmail} />
              <Row label="Login linked" value={e.user ? 'Yes' : 'Not yet'} />
              <Row label="PAN" value={last4(e.panLast4)} />
              <Row label="Aadhaar" value={last4(e.aadhaarLast4)} />
              <Row label="Bank account" value={e.bank.accountLast4 ? `${last4(e.bank.accountLast4)}${e.bank.ifsc ? ` · ${e.bank.ifsc}` : ''}` : 'Not added'} />
              <Row label="UPI" value={e.bank.hasUpi ? 'On file' : 'Not added'} />
              <Row label="UAN (PF)" value={e.uan} />
              <Row label="Attendance" value={e.manualAttendance ? 'Recorded by HR' : e.anywhereAllowed ? 'App, anywhere (field)' : 'App, at work sites'} />
            </dl>
          </section>
          <div className="space-y-4">
            <OnboardingChecklist employee={e} />
            <LeaveBalances employeeId={e.id} />
          </div>
          <div className="lg:col-span-2"><SalaryPanel employeeId={e.id} readOnly={e.status === 'exited'} /></div>
        </div>
      )}
    </div>
  );
}
