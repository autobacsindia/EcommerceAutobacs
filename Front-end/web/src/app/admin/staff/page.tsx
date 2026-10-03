'use client';

import { useState } from 'react';
import TeamMembersPanel, { STAFF_TEAM_LABELS, type StaffTeam } from '@/components/staff/TeamMembersPanel';

const TEAMS = Object.keys(STAFF_TEAM_LABELS) as StaffTeam[];

/**
 * Staff & teams. The admin adds each team's HEAD here; heads then add their own
 * members from the team panel (/team). Staff use /team, never /admin.
 */
export default function AdminStaffPage() {
  const [team, setTeam] = useState<StaffTeam>('sales');

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Staff &amp; Teams</h1>
        <p className="mt-1 text-sm text-gray-500">
          Add a <strong>team head</strong> for each team. Heads add and remove their own members from
          their panel at <code>/team</code>. Staff can never open this admin area.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {TEAMS.map((t) => (
          <button
            key={t}
            onClick={() => setTeam(t)}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${
              team === t ? 'bg-blue-600 text-white' : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            {STAFF_TEAM_LABELS[t]}
          </button>
        ))}
      </div>

      {/* key: remount per team so the invite form and notices reset cleanly. */}
      <TeamMembersPanel key={team} team={team} allowHeadInvite />
    </div>
  );
}
