'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Search } from 'lucide-react';
import { hrApi } from '@/lib/hr/api';
import { hrKeys } from '@/lib/hr/keys';
import { dayLabel } from '@/lib/hr/format';
import type { EmployeeListFilter, EmployeeListRow, EmployeeStatus } from '@/lib/hr/types';
import { STAFF_TEAM_LABELS, STAFF_TEAM_OPTIONS, type StaffTeam } from '@/lib/staffTeams';
import StatusChip, { type ChipTone } from './StatusChip';
import { PersonCell } from './Initials';
import { useHrList } from './useHrList';
import {
  HrEmpty, HrErrorState, HrLoadMore, HrLoading, HrPageHeader, hrBtnGhost, hrBtnPrimary, hrCard, hrField, hrInput, hrTable, hrTd, hrTh,
} from './HrStates';

const TABS: { key: EmployeeListFilter; label: string }[] = [
  { key: 'current', label: 'Current' },
  { key: 'onboarding', label: 'Joining' },
  { key: 'exited', label: 'Left' },
  { key: 'all', label: 'All' },
];

export const STATUS_CHIP: Record<EmployeeStatus, { label: string; tone: ChipTone }> = {
  onboarding: { label: 'Joining', tone: 'info' },
  active: { label: 'Active', tone: 'ok' },
  notice: { label: 'On notice', tone: 'warn' },
  exited: { label: 'Left', tone: 'muted' },
};

export const teamLabel = (team: string) => STAFF_TEAM_LABELS[team as StaffTeam] || team || '—';

export default function EmployeesList() {
  const router = useRouter();
  const [status, setStatus] = useState<EmployeeListFilter>('current');
  const [team, setTeam] = useState('');
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const list = useHrList<EmployeeListRow>(
    hrKeys.employeeList({ status, team, q }),
    (cursor) => hrApi.listEmployees({ status, team: team || undefined, q: q || undefined, cursor }),
  );
  const onSearch = (e: FormEvent) => { e.preventDefault(); setQ(qInput.trim()); };

  return (
    <div className="max-w-6xl">
      <HrPageHeader
        title="Employees"
        actions={<Link href="/hr/employees/new" className={hrBtnPrimary}><Plus className="h-4 w-4" aria-hidden="true" /> Add employee</Link>}
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Status" className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.key} type="button" role="tab" aria-selected={status === t.key} onClick={() => setStatus(t.key)}
              className={`rounded-full px-3 py-1 text-sm font-semibold ${status === t.key ? 'bg-emerald-700 text-white' : 'bg-white text-gray-700 ring-1 ring-gray-300'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <label className="sr-only" htmlFor="hr-emp-team">Team</label>
        <select id="hr-emp-team" value={team} onChange={(e) => setTeam(e.target.value)} className={`${hrField} w-auto`}>
          <option value="">All teams</option>
          {STAFF_TEAM_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <form onSubmit={onSearch} className="flex items-center gap-1.5">
          <label className="sr-only" htmlFor="hr-emp-q">Search by name or code</label>
          <input id="hr-emp-q" value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Name or EMP-code" className={`${hrField} w-48`} />
          <button type="submit" className={hrBtnGhost} aria-label="Search"><Search className="h-4 w-4" aria-hidden="true" /></button>
        </form>
      </div>

      {list.isError ? <HrErrorState error={list.error} onRetry={() => list.refetch()} /> : list.isPending ? <HrLoading /> : !list.rows.length ? (
        <HrEmpty title={q ? 'Nobody matches that search' : 'No employees here yet'}>
          {!q && <Link href="/hr/employees/new" className="font-semibold text-emerald-700 underline">Add the first employee</Link>}
        </HrEmpty>
      ) : (
        <div className={`${hrCard} overflow-x-auto`}>
          <table className={hrTable}>
            <thead>
              <tr>
                <th className={hrTh}>Employee</th><th className={hrTh}>Code</th><th className={hrTh}>Team</th>
                <th className={hrTh}>Joined</th><th className={hrTh}>Status</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((e) => (
                <tr
                  key={e.id}
                  className="cursor-pointer hover:bg-gray-50"
                  onClick={() => router.push(`/hr/employees/${e.id}`)}
                >
                  <td className={hrTd}>
                    <Link href={`/hr/employees/${e.id}`} onClick={(ev) => ev.stopPropagation()} className="block">
                      <PersonCell name={e.name} sub={e.designation} />
                    </Link>
                  </td>
                  <td className={`${hrTd} font-mono text-xs`}>{e.employeeCode}</td>
                  <td className={hrTd}>{teamLabel(e.team)}</td>
                  <td className={hrTd}>{dayLabel(e.joinDate)}</td>
                  <td className={hrTd}><StatusChip tone={STATUS_CHIP[e.status].tone}>{STATUS_CHIP[e.status].label}</StatusChip></td>
                </tr>
              ))}
            </tbody>
          </table>
          <HrLoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()} />
        </div>
      )}
      <p className="mt-3 text-xs text-gray-500">Click a person to see their profile, onboarding and leave. PAN and bank numbers show only the last 4 digits.</p>
    </div>
  );
}
