'use client';

import TeamMembersPanel from '@/components/staff/TeamMembersPanel';

/** The caller's own team. The server pins staff to their team and decides who may manage it. */
export default function TeamMembersPage() {
  return (
    <div className="max-w-5xl">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">My team</h1>
      <TeamMembersPanel />
    </div>
  );
}
