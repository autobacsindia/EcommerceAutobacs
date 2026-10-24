'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, UserMinus, UserPlus } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { chatKeys } from '@/hooks/queries/keys';
import { useChatPeople, type ChatPerson } from '@/hooks/queries/useTeamChat';

type Members = { members: ChatPerson[]; canManage: boolean; createdBy: string | null };

const errorText = (e: unknown, fallback: string) =>
  (e as { rawData?: { message?: string } })?.rawData?.message || fallback;

/**
 * A custom group's members. Everyone in it can see who is there; the admin and
 * the person who created it can add and remove people (the API enforces this).
 */
export default function MembersPanel({ channelId }: { channelId: string }) {
  const qc = useQueryClient();
  const key = chatKeys.members(channelId);
  const q = useQuery({ queryKey: key, queryFn: () => apiClient.get<Members>(`/chat/channels/${channelId}/members`) });
  const people = useChatPeople(!!q.data?.canManage);
  const [picked, setPicked] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');

  const inGroup = useMemo(() => new Set((q.data?.members ?? []).map((m) => m.id)), [q.data]);
  const candidates = (people.data ?? [])
    .filter((p) => !inGroup.has(p.id))
    .filter((p) => !filter.trim() || p.name.toLowerCase().includes(filter.trim().toLowerCase()));

  const refresh = async (data: { members: ChatPerson[] }) => {
    qc.setQueryData<Members>(key, (d) => (d ? { ...d, members: data.members } : d));
    await qc.invalidateQueries({ queryKey: chatKeys.channels() });
  };
  const add = useMutation({
    mutationFn: () => apiClient.post<{ members: ChatPerson[] }>(`/chat/channels/${channelId}/members`, { userIds: picked }),
    onSuccess: async (data) => { setPicked([]); setError(''); await refresh(data); },
    onError: (e) => setError(errorText(e, 'Could not add them. Please try again.')),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => apiClient.delete<{ members: ChatPerson[] }>(`/chat/channels/${channelId}/members/${userId}`),
    onSuccess: async (data) => { setError(''); await refresh(data); },
    onError: (e) => setError(errorText(e, 'Could not remove them. Please try again.')),
  });

  if (q.isPending) return <p className="flex items-center gap-2 p-4 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading members…</p>;
  if (q.isError) return <p role="alert" className="m-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorText(q.error, 'Could not load the members.')}</p>;
  const { members, canManage, createdBy } = q.data;

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{members.length} member{members.length === 1 ? '' : 's'}</h3>
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="font-medium text-gray-900">{m.name}</span>
                <span className="ml-2 text-xs text-gray-500">{[m.role === 'admin' ? 'Admin' : m.teamLabel, m.id === createdBy ? 'Created the group' : null].filter(Boolean).join(' · ')}</span>
              </span>
              {canManage && m.id !== createdBy && (
                <button type="button" disabled={remove.isPending} onClick={() => { if (window.confirm(`Remove ${m.name} from this group?`)) remove.mutate(m.id); }}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50" aria-label={`Remove ${m.name}`}>
                  <UserMinus className="h-3.5 w-3.5" /> Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {canManage && (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Add people</h3>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search by name" aria-label="Search people to add"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100" />
          {people.isPending && <p className="text-xs text-gray-500">Loading people…</p>}
          {people.isSuccess && candidates.length === 0 && <p className="text-xs text-gray-500">Everyone{filter ? ' with that name' : ''} is already in the group.</p>}
          <ul className="max-h-60 divide-y divide-gray-100 overflow-y-auto rounded-xl border border-gray-200">
            {candidates.map((p) => (
              <li key={p.id}>
                <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50">
                  <input type="checkbox" checked={picked.includes(p.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, p.id] : picked.filter((x) => x !== p.id))} />
                  <span className="font-medium text-gray-900">{p.name}</span>
                  <span className="text-xs text-gray-500">{p.role === 'admin' ? 'Admin' : p.teamLabel}</span>
                </label>
              </li>
            ))}
          </ul>
          <button type="button" disabled={!picked.length || add.isPending} onClick={() => add.mutate()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
            {add.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Add {picked.length || ''} to group
          </button>
        </section>
      )}
    </div>
  );
}
