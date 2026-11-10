'use client';

import Link from 'next/link';
import { useState } from 'react';
import { UserMinus } from 'lucide-react';
import { STAFF_TEAM_OPTIONS } from '@/lib/staffTeams';
import { field, quietButton } from '@/components/training/types';
import { usePastMembers } from './hooks';
import { dateLabel, timeOnTeam, type PastMember } from './types';

function Row({ m, base, showTeam }: { m: PastMember; base: string; showTeam: boolean }) {
  return (
    <Link href={`${base}/${m.id}`} className="block rounded-xl border border-gray-200 bg-white p-4 hover:border-blue-400">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="font-semibold text-gray-900">{m.name || 'Name not saved'}</h2>
        <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">{showTeam ? `${m.teamLabel} · ` : ''}{m.roleLabel}</span>
      </div>
      <p className="mt-1 text-sm text-gray-600">
        Last day {m.lastDay ? dateLabel(`${m.lastDay}T12:00:00Z`) : 'not known'} · On the team {timeOnTeam(m.daysOnTeam)}
      </p>
    </Link>
  );
}

/** People who left the team. Admins (`pickTeam`) can choose a team; staff always see their own. */
export default function PastMembersHome({ base, pickTeam = false }: { base: string; pickTeam?: boolean }) {
  const [team, setTeam] = useState('');
  const pages = usePastMembers(pickTeam ? team : '');
  const rows = pages.data?.pages.flatMap((p) => p.members) ?? [];

  return (
    <div className="max-w-4xl">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Past members</h1>
          <p className="mt-1 text-sm text-gray-600">People who used to be on {pickTeam ? 'a' : 'your'} team. Open one to see the work they did and their handover note.</p>
        </div>
        {pickTeam && (
          <div>
            <label htmlFor="pm-team" className="mb-1 block text-sm font-medium text-gray-800">Team</label>
            <select id="pm-team" className={field} value={team} onChange={(e) => setTeam(e.target.value)}>
              <option value="">All teams</option>
              {STAFF_TEAM_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
        )}
      </div>
      {pages.isError && <p className="text-sm text-red-700">This could not be loaded. <button type="button" className="underline" onClick={() => void pages.refetch()}>Try again</button></p>}
      {pages.isLoading && <p className="text-sm text-gray-600">Loading…</p>}
      {pages.isSuccess && !rows.length && (
        <div className="rounded-xl border border-dashed border-gray-300 p-10 text-center">
          <UserMinus aria-hidden className="mx-auto h-8 w-8 text-gray-400" />
          <p className="mt-2 text-sm text-gray-600">Nobody has left {pickTeam && !team ? 'any team' : 'this team'} yet.</p>
        </div>
      )}
      {rows.length > 0 && <div className="space-y-3">{rows.map((m) => <Row key={m.id} m={m} base={base} showTeam={pickTeam} />)}</div>}
      {pages.hasNextPage && (
        <button type="button" className={`${quietButton} mt-4`} disabled={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>
          {pages.isFetchingNextPage ? 'Loading…' : 'Show more'}
        </button>
      )}
    </div>
  );
}
