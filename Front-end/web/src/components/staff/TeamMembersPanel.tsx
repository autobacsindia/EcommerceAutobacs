'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, UserPlus, UserMinus, X, Mail } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { useAuth } from '@/context/AuthContext';
import { formatDateIST } from '@/lib/datetime';

export type StaffTeam = 'sales' | 'procurement' | 'accounts' | 'marketing';

export const STAFF_TEAM_LABELS: Record<StaffTeam, string> = {
  sales: 'Sales',
  procurement: 'Procurement',
  accounts: 'Accounts',
  marketing: 'Marketing',
};

type Member = { id: string; name: string; email: string; phone: string; isHead: boolean; addedAt: string };
type Invite = { id: string; name: string; email: string; phone: string; isHead: boolean; expiresAt: string; expired: boolean };
type TeamResponse = {
  success: boolean;
  team: StaffTeam;
  teamLabel: string;
  canManage: boolean;
  members: Member[];
  invites: Invite[];
};

const errorMessage = (e: unknown, fallback: string) =>
  (e as { rawData?: { message?: string } })?.rawData?.message || fallback;

/**
 * Members + open invites for one team, with add / withdraw / remove.
 *
 * Shared by the team head's "My team" page and the admin Staff screen. The server
 * decides what the caller may do (heads: own team, members only); `canManage` and
 * `allowHeadInvite` only shape the UI around that.
 */
export default function TeamMembersPanel({
  team,
  allowHeadInvite = false,
}: {
  /** Admin view names the team; a staff caller is pinned to their own by the server. */
  team?: StaffTeam;
  allowHeadInvite?: boolean;
}) {
  const { user } = useAuth();
  const [data, setData] = useState<TeamResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [warning, setWarning] = useState('');
  const [form, setForm] = useState({ name: '', email: '', phone: '', isHead: false });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const qs = team ? `?team=${team}` : '';
      setData(await apiClient.get<TeamResponse>(`/staff/team${qs}`));
    } catch (e) {
      setError(errorMessage(e, 'Could not load the team.'));
    } finally {
      setLoading(false);
    }
  }, [team]);

  useEffect(() => { load(); }, [load]);

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(''); setNotice(''); setWarning('');
    try {
      const res = await apiClient.post<{ emailSent: boolean; existingAccount: boolean }>('/staff/invites', {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        ...(team ? { team } : {}),
        ...(allowHeadInvite ? { isHead: form.isHead } : {}),
      });
      if (res.emailSent) {
        setNotice(`Invite sent to ${form.email.trim()}. They must open the link in the email (check spam) and set a password. The link expires in 48 hours.`);
      } else {
        setWarning('Invite saved, but the email could not be sent. Withdraw it and try again, or check the email settings.');
      }
      setForm({ name: '', email: '', phone: '', isHead: false });
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Could not send the invite.'));
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(invite: Invite) {
    if (!window.confirm(`Withdraw the invite for ${invite.email}? Their link will stop working.`)) return;
    setBusy(true); setError(''); setNotice(''); setWarning('');
    try {
      await apiClient.delete(`/staff/invites/${invite.id}`);
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Could not withdraw the invite.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(member: Member) {
    if (!window.confirm(`Remove ${member.name}'s access? They will be signed out immediately and lose the ${data?.teamLabel} panel.`)) return;
    setBusy(true); setError(''); setNotice(''); setWarning('');
    try {
      await apiClient.post(`/staff/members/${member.id}/deactivate`, {});
      setNotice(`${member.name} no longer has access.`);
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Could not remove access.'));
    } finally {
      setBusy(false);
    }
  }

  const isAdminView = user?.role === 'admin';
  const canRemove = (m: Member) =>
    !!data?.canManage && m.id !== user?._id && (isAdminView || !m.isHead);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">
          {data ? `${data.teamLabel} team` : 'Team'}
        </h2>
        <button
          onClick={load}
          className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {notice && <p className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">{notice}</p>}
      {warning && <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">{warning}</p>}

      {data?.canManage && (
        <form onSubmit={sendInvite} className="rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-800">
            <UserPlus className="h-4 w-4" /> Add a person
          </h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <input
              required minLength={2} maxLength={100}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Full name"
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <input
              required type="email" maxLength={254}
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="Email (their own)"
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <input
              required inputMode="numeric" pattern="(\+91[\s-]?)?[6-9][0-9]{9}"
              title="10-digit Indian mobile number"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="Mobile number"
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            {allowHeadInvite ? (
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.isHead}
                  onChange={(e) => setForm({ ...form, isHead: e.target.checked })}
                />
                Make this person the team head (they can add and remove members)
              </label>
            ) : <span className="text-xs text-gray-500">They will get an email to set their own password.</span>}
            <button
              type="submit"
              disabled={busy}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Mail className="h-4 w-4" /> Send invite
            </button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Mobile</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Added</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading && !data ? (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500">Loading…</td></tr>
            ) : data?.members.length ? data.members.map((m) => (
              <tr key={m.id}>
                <td className="px-4 py-3 font-medium text-gray-900">{m.name}</td>
                <td className="px-4 py-3 text-gray-700">{m.email}</td>
                <td className="px-4 py-3 text-gray-700">{m.phone}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${m.isHead ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-700'}`}>
                    {m.isHead ? 'Head' : 'Member'}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-gray-500">{formatDateIST(m.addedAt)}</td>
                <td className="px-4 py-3 text-right">
                  {canRemove(m) && (
                    <button
                      onClick={() => remove(m)}
                      disabled={busy}
                      className="inline-flex items-center gap-1 rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      <UserMinus className="h-3.5 w-3.5" /> Remove access
                    </button>
                  )}
                </td>
              </tr>
            )) : (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500">No one on this team yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {!!data?.invites.length && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <h3 className="border-b px-4 py-3 text-sm font-semibold text-gray-800">Waiting to accept</h3>
          <table className="w-full text-sm">
            <tbody className="divide-y">
              {data.invites.map((i) => (
                <tr key={i.id}>
                  <td className="px-4 py-3 font-medium text-gray-900">{i.name}{i.isHead ? ' (Head)' : ''}</td>
                  <td className="px-4 py-3 text-gray-700">{i.email}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs">
                    {i.expired
                      ? <span className="text-red-600">Link expired — withdraw and invite again</span>
                      : <span className="text-gray-500">Link valid until {formatDateIST(i.expiresAt)}</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {data.canManage && (isAdminView || !i.isHead) && (
                      <button
                        onClick={() => withdraw(i)}
                        disabled={busy}
                        className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        <X className="h-3.5 w-3.5" /> Withdraw
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
