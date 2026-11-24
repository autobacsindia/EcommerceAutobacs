'use client';

import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import DelayList from '@/components/delays/DelayList';
import DelayRanking from '@/components/delays/DelayRanking';

/**
 * My delays — everything the signed-in person owns that is late, due today or
 * pending: order steps they moved, parcels they dispatched or dated, their tasks
 * and projects. A team head also gets "My team" (their own team only).
 */
export default function MyDelaysPage() {
  const { user } = useAuth();
  const isHead = user?.role === 'staff' && !!user.staff?.isHead;
  const [tab, setTab] = useState<'mine' | 'team'>('mine');
  const tabBtn = (active: boolean) => `rounded-lg px-3 py-1.5 text-sm font-semibold ${active ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`;
  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">My delays</h1>
        <p className="text-sm text-gray-500">
          What is late, due today or waiting on you — counted in office hours (Mon–Sat, 9:30–6:30). Give a reason or move it
          along from here.
        </p>
      </div>
      {isHead && (
        <div role="tablist" className="flex gap-2">
          <button type="button" role="tab" aria-selected={tab === 'mine'} className={tabBtn(tab === 'mine')} onClick={() => setTab('mine')}>Mine</button>
          <button type="button" role="tab" aria-selected={tab === 'team'} className={tabBtn(tab === 'team')} onClick={() => setTab('team')}>My team</button>
        </div>
      )}
      {isHead && tab === 'team' ? <DelayRanking mode="team" /> : <DelayList mode="team" />}
    </div>
  );
}
