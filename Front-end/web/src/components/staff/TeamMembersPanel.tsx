'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, UserPlus, UserMinus, X, Mail, KeyRound, Copy, Building2, Pencil } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { useAuth } from '@/context/AuthContext';
import { formatDateIST } from '@/lib/datetime';

export type StaffTeam = 'sales' | 'procurement' | 'accounts' | 'marketing' | 'operations';

export const STAFF_TEAM_LABELS: Record<StaffTeam, string> = {
  sales: 'GTM',
  procurement: 'Procurement',
  accounts: 'Accounts',
  marketing: 'Marketing',
  operations: 'Operations',
};

type Member = {
  id: string; name: string; email: string; phone: string; isHead: boolean; addedAt: string;
  username?: string | null; companyAccount?: boolean;
  /** GTM: 'lead' | 'executive' | 'support' (null for heads and other teams). */
  subRole?: string | null;
  /** "GTM head", "GTM lead", "Procurement head", "Member"… */
  roleLabel?: string | null;
};

/** Roles inside GTM (the 'sales' team) — what each new GTM login can do. */
const GTM_ROLES = [
  { value: 'lead', label: 'GTM lead', hint: 'Sells: orders, payment links, quotations, customer decisions' },
  { value: 'executive', label: 'GTM executive', hint: 'Can sign in and use team chat; tools coming soon' },
  { value: 'support', label: 'Customer support', hint: 'Can sign in and use team chat; tools coming soon' },
] as const;

/** Same rule the server enforces (config/staff.js). */
const USERNAME_PATTERN = '[a-z0-9][a-z0-9._\\-]{1,28}[a-z0-9]';

/**
 * A password for a company account. Random, with no look-alike characters,
 * since it is read out or typed from a note. The person keeps using it until
 * the admin changes it.
 */
export function generateTempPassword(length = 12): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  const core = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  return `${core}#7`;
}

/** Sign-in details shown once after creating or resetting a company account. */
type Credentials = { name: string; username: string; password: string; reset: boolean };
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
  // New people get a company login by default: the company owns it, so nothing
  // walks out with them. Inviting someone's own email stays available.
  const [mode, setMode] = useState<'company' | 'invite'>('company');
  const [account, setAccount] = useState({ name: '', username: '', phone: '', password: '', isHead: false, subRole: 'lead' });
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  // The member whose password is being changed, and the new one being typed.
  const [changing, setChanging] = useState<{ member: Member; password: string } | null>(null);
  // Admin: the member being edited (name, mobile, username, team, head, GTM role).
  const [editing, setEditing] = useState<{
    member: Member; name: string; phone: string; username: string; team: StaffTeam; isHead: boolean; subRole: string;
  } | null>(null);

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

  async function createAccount(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(''); setNotice(''); setWarning(''); setCredentials(null);
    const username = account.username.trim().toLowerCase();
    try {
      await apiClient.post('/staff/accounts', {
        name: account.name.trim(),
        username,
        phone: account.phone.trim(),
        password: account.password,
        ...(team ? { team } : {}),
        ...(allowHeadInvite ? { isHead: account.isHead } : {}),
        // A GTM member gets a role; a GTM head does not.
        ...(isGtm && !account.isHead ? { subRole: account.subRole } : {}),
      });
      setCredentials({ name: account.name.trim(), username, password: account.password, reset: false });
      setAccount({ name: '', username: '', phone: '', password: '', isHead: false, subRole: 'lead' });
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Could not create the account.'));
    } finally {
      setBusy(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!changing) return;
    const { member, password } = changing;
    if (!window.confirm(`Change ${member.name}'s password? They will be signed out everywhere and must sign in with the new one.`)) return;
    setBusy(true); setError(''); setNotice(''); setWarning(''); setCredentials(null);
    try {
      await apiClient.post(`/staff/members/${member.id}/password`, { password });
      setCredentials({ name: member.name, username: member.username || '', password, reset: true });
      setChanging(null);
    } catch (err) {
      setError(errorMessage(err, 'Could not change the password.'));
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

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const { member } = editing;
    const roleChange = editing.team !== (data?.team ?? team) || editing.isHead !== member.isHead
      || (editing.team === 'sales' && !editing.isHead && editing.subRole !== (member.subRole ?? 'lead'));
    if (roleChange && !window.confirm(`Change ${member.name}'s team or role? They will be signed out and sign in again with the new access.`)) return;
    setBusy(true); setError(''); setNotice(''); setWarning('');
    try {
      await apiClient.put(`/staff/members/${member.id}`, {
        name: editing.name.trim(),
        phone: editing.phone.trim(),
        ...(member.companyAccount ? { username: editing.username.trim().toLowerCase() } : {}),
        team: editing.team,
        isHead: editing.isHead,
        ...(editing.team === 'sales' && !editing.isHead ? { subRole: editing.subRole } : {}),
      });
      setNotice(`${editing.name.trim()} saved.${roleChange ? ' They have been signed out and will sign in with the new access.' : ''}`);
      setEditing(null);
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Could not save the changes.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(member: Member) {
    if (!window.confirm(`Delete ${member.name} from the ${data?.teamLabel} team? They are signed out at once and can no longer sign in. Their past work (orders, chats, approvals) stays and still shows their name.`)) return;
    setBusy(true); setError(''); setNotice(''); setWarning('');
    try {
      await apiClient.post(`/staff/members/${member.id}/deactivate`, {});
      setNotice(`${member.name} was removed from the team. Their past work is kept.`);
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Could not remove access.'));
    } finally {
      setBusy(false);
    }
  }

  const isAdminView = user?.role === 'admin';
  const isGtm = (data?.team ?? team) === 'sales';
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

      {credentials && (
        <div className="rounded-lg border border-green-300 bg-green-50 p-4 text-sm text-green-900" role="status">
          <p className="font-semibold">
            {credentials.reset ? `New password for ${credentials.name}` : `Account created for ${credentials.name}`}
          </p>
          <p className="mt-1">Give them these details. The password is shown only now — keep it somewhere safe. They sign in with it until you change it.</p>
          <dl className="mt-3 grid max-w-md grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2">
            <dt className="text-green-800">Username</dt>
            <dd className="font-mono font-semibold">{credentials.username}</dd>
            <CopyButton value={credentials.username} label="Copy username" />
            <dt className="text-green-800">Password</dt>
            <dd className="font-mono font-semibold">{credentials.password}</dd>
            <CopyButton value={credentials.password} label="Copy password" />
          </dl>
          <p className="mt-3 text-xs text-green-800">Sign-in page: autobacsindia.com/login</p>
          <button type="button" onClick={() => setCredentials(null)} className="mt-3 text-xs font-semibold underline">Done — hide these details</button>
        </div>
      )}

      {changing && (
        <form onSubmit={changePassword} className="rounded-lg border border-blue-200 bg-blue-50 p-4" aria-label={`Change password for ${changing.member.name}`}>
          <p className="text-sm font-semibold text-gray-900">
            New password for {changing.member.name} <span className="font-mono font-normal text-gray-600">({changing.member.username})</span>
          </p>
          <p className="mt-1 text-xs text-gray-600">Their old password stops working at once and they are signed out everywhere.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              required minLength={8} maxLength={72}
              value={changing.password}
              onChange={(e) => setChanging({ ...changing, password: e.target.value })}
              placeholder="New password"
              aria-label="New password"
              autoComplete="new-password"
              className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm"
            />
            <button type="button" onClick={() => setChanging({ ...changing, password: generateTempPassword() })}
              className="rounded-lg border border-gray-300 bg-white px-3 text-xs font-medium text-gray-700 hover:bg-gray-50">
              Generate
            </button>
            <button type="submit" disabled={busy}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              Save password
            </button>
            <button type="button" onClick={() => setChanging(null)}
              className="rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-white">
              Cancel
            </button>
          </div>
        </form>
      )}

      {editing && (
        <form onSubmit={saveEdit} className="rounded-lg border border-blue-200 bg-blue-50 p-4" aria-label={`Edit ${editing.member.name}`}>
          <p className="text-sm font-semibold text-gray-900">Edit {editing.member.name}</p>
          <p className="mt-1 text-xs text-gray-600">Changing the team or role signs them out; their history stays with them.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-gray-700">Full name
              <input required minLength={2} maxLength={100} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" />
            </label>
            <label className="text-xs font-medium text-gray-700">Mobile number
              <input required inputMode="tel" value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" />
            </label>
            {editing.member.companyAccount && (
              <label className="text-xs font-medium text-gray-700">Username (sign-in)
                <input required pattern={USERNAME_PATTERN} value={editing.username} onChange={(e) => setEditing({ ...editing, username: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm" />
              </label>
            )}
            <label className="text-xs font-medium text-gray-700">Team
              <select value={editing.team} onChange={(e) => setEditing({ ...editing, team: e.target.value as StaffTeam })}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                {(Object.keys(STAFF_TEAM_LABELS) as StaffTeam[]).map((t) => <option key={t} value={t}>{STAFF_TEAM_LABELS[t]}</option>)}
              </select>
            </label>
            {editing.team === 'sales' && !editing.isHead && (
              <label className="text-xs font-medium text-gray-700">GTM role
                <select value={editing.subRole} onChange={(e) => setEditing({ ...editing, subRole: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                  {GTM_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </label>
            )}
            <label className="flex items-center gap-2 self-end text-sm text-gray-800">
              <input type="checkbox" checked={editing.isHead} onChange={(e) => setEditing({ ...editing, isHead: e.target.checked })} />
              Team head (can add and remove members)
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <button type="submit" disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">Save changes</button>
            <button type="button" onClick={() => setEditing(null)} className="rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-white">Cancel</button>
          </div>
        </form>
      )}

      {data?.canManage && (
        <div className="flex gap-2" role="tablist" aria-label="How to add a person">
          {([['company', 'Company login', Building2], ['invite', 'Invite by email', Mail]] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={mode === key}
              onClick={() => setMode(key)}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium ${
                mode === key ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
      )}

      {data?.canManage && mode === 'company' && (
        <form onSubmit={createAccount} className="rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-gray-800">
            <UserPlus className="h-4 w-4" /> Add a person with a company login
          </h3>
          <p className="mb-3 text-xs text-gray-500">
            The company owns this login and its password. Change the password any time; if they leave, remove access — their work stays here.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <input
              required minLength={2} maxLength={100}
              value={account.name}
              onChange={(e) => setAccount({ ...account, name: e.target.value })}
              placeholder="Full name"
              aria-label="Full name"
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <input
              required minLength={3} maxLength={30} pattern={USERNAME_PATTERN}
              title="3–30 characters: lowercase letters, numbers, dot, dash or underscore"
              autoCapitalize="none" autoCorrect="off" spellCheck={false}
              value={account.username}
              onChange={(e) => setAccount({ ...account, username: e.target.value.toLowerCase().replace(/\s+/g, '') })}
              placeholder="Username, e.g. sam.sales"
              aria-label="Username"
              className="rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm"
            />
            <input
              required inputMode="numeric" pattern="(\+91[\s-]?)?[6-9][0-9]{9}"
              title="10-digit Indian mobile number"
              value={account.phone}
              onChange={(e) => setAccount({ ...account, phone: e.target.value })}
              placeholder="Mobile number"
              aria-label="Mobile number"
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <input
                required minLength={8} maxLength={72}
                value={account.password}
                onChange={(e) => setAccount({ ...account, password: e.target.value })}
                placeholder="First password"
                aria-label="First password"
                autoComplete="new-password"
                className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm"
              />
              <button
                type="button"
                onClick={() => setAccount({ ...account, password: generateTempPassword() })}
                className="shrink-0 rounded-lg border border-gray-300 px-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Generate
              </button>
            </div>
          </div>
          {isGtm && !account.isHead && (
            <fieldset className="mt-3">
              <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">Role</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {GTM_ROLES.map((r) => (
                  <label
                    key={r.value}
                    className={`flex cursor-pointer gap-2 rounded-lg border p-2.5 text-sm ${
                      account.subRole === r.value ? 'border-blue-600 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="gtm-role"
                      value={r.value}
                      checked={account.subRole === r.value}
                      onChange={() => setAccount({ ...account, subRole: r.value })}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="block font-medium text-gray-900">{r.label}</span>
                      <span className="block text-xs text-gray-500">{r.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            {allowHeadInvite ? (
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={account.isHead}
                  onChange={(e) => setAccount({ ...account, isHead: e.target.checked })}
                />
                Make this person the {isGtm ? 'GTM head' : 'team head'} (they can add and remove members)
              </label>
            ) : <span className="text-xs text-gray-500">Only you (or the admin) can change this password later.</span>}
            <button
              type="submit"
              disabled={busy}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Building2 className="h-4 w-4" /> Create login
            </button>
          </div>
        </form>
      )}

      {data?.canManage && mode === 'invite' && (
        <form onSubmit={sendInvite} className="rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-800">
            <UserPlus className="h-4 w-4" /> Invite by email
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
              <th className="px-4 py-3">Login</th>
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
                <td className="px-4 py-3 text-gray-700">
                  {m.companyAccount ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="font-mono">{m.username}</span>
                      <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-blue-700">Company</span>
                    </span>
                  ) : m.email}
                </td>
                <td className="px-4 py-3 text-gray-700">{m.phone}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${m.isHead ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-700'}`}>
                    {m.roleLabel || (m.isHead ? 'Head' : 'Member')}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-gray-500">{formatDateIST(m.addedAt)}</td>
                <td className="space-x-2 whitespace-nowrap px-4 py-3 text-right">
                  {isAdminView && m.id !== user?._id && (
                    <button
                      onClick={() => {
                        setCredentials(null); setChanging(null);
                        setEditing({
                          member: m, name: m.name, phone: m.phone, username: m.username || '',
                          team: (data?.team ?? team ?? 'sales') as StaffTeam, isHead: m.isHead, subRole: m.subRole || 'lead',
                        });
                      }}
                      disabled={busy}
                      className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </button>
                  )}
                  {canRemove(m) && m.companyAccount && (
                    <button
                      onClick={() => { setCredentials(null); setEditing(null); setChanging({ member: m, password: '' }); }}
                      disabled={busy}
                      className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      <KeyRound className="h-3.5 w-3.5" /> Change password
                    </button>
                  )}
                  {canRemove(m) && (
                    <button
                      onClick={() => remove(m)}
                      disabled={busy}
                      className="inline-flex items-center gap-1 rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      <UserMinus className="h-3.5 w-3.5" /> {isAdminView ? 'Delete' : 'Remove access'}
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

/** Copy one credential to the clipboard, confirming briefly. */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch { /* clipboard blocked — the value is on screen to copy by hand */ }
      }}
      className="inline-flex items-center gap-1 rounded border border-green-400 px-2 py-0.5 text-xs font-medium hover:bg-green-100"
    >
      <Copy className="h-3 w-3" /> {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
