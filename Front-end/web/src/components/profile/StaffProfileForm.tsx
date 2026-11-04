'use client';

/**
 * "My profile" for staff and admins (/team/profile, /admin/profile): photo, name,
 * phone, job title, team (read-only), date of birth, emergency contact and a short
 * bio. Role, team and email are shown but never sent — the server ignores them
 * anyway (utils/profileUpdate.js). Password has its own page.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UserRound } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { useAuth } from '@/context/AuthContext';
import { chatKeys, profileKeys } from '@/hooks/queries/keys';
import PhotoEditor from './PhotoEditor';

export type MyProfile = {
  name: string;
  email: string;
  phone: string;
  role: string;
  teamLabel: string | null;
  avatar: { url: string };
  profile: { jobTitle: string; dateOfBirth: string; emergencyContact: { name: string; phone: string }; bio: string };
};

type Form = { name: string; phone: string; jobTitle: string; dateOfBirth: string; ecName: string; ecPhone: string; bio: string };

const toForm = (p: MyProfile): Form => ({
  name: p.name || '',
  phone: p.phone || '',
  jobTitle: p.profile.jobTitle,
  dateOfBirth: p.profile.dateOfBirth,
  ecName: p.profile.emergencyContact.name,
  ecPhone: p.profile.emergencyContact.phone,
  bio: p.profile.bio,
});

const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm';
const todayIso = () => new Date().toISOString().slice(0, 10);

export default function StaffProfileForm({ passwordHref }: { passwordHref?: string }) {
  const { user, refreshUser } = useAuth();
  const qc = useQueryClient();
  const { data, isPending, error: loadError } = useQuery({
    queryKey: profileKeys.myProfile(),
    queryFn: async () => (await apiClient.get<{ me: MyProfile }>('/profile')).me,
  });
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => { if (data && !form) setForm(toForm(data)); }, [data, form]);

  if (isPending || (!form && !loadError)) return <p className="text-sm text-gray-500">Loading your profile…</p>;
  if (loadError || !data || !form) return <p role="alert" className="text-sm text-red-600">Could not load your profile. Please refresh.</p>;

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setSaved(false);
    setForm({ ...form, [k]: e.target.value });
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setError('');
    try {
      const res = await apiClient.put<{ user: MyProfile }>('/profile', {
        name: form.name,
        phone: form.phone,
        profile: {
          jobTitle: form.jobTitle,
          dateOfBirth: form.dateOfBirth,
          emergencyContact: form.ecName || form.ecPhone ? { name: form.ecName, phone: form.ecPhone } : null,
          bio: form.bio,
        },
      });
      qc.setQueryData(profileKeys.myProfile(), res.user);
      setForm(toForm(res.user));
      setSaved(true);
      await refreshUser(); // the panel header shows the new name
    } catch (err) {
      setError((err as { rawData?: { message?: string } })?.rawData?.message || 'Could not save. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function photoChanged(url: string) {
    qc.setQueryData<MyProfile>(profileKeys.myProfile(), (p) => (p ? { ...p, avatar: { url } } : p));
    // My face in Tasks and Team Chat (list, messages, people) follows at once.
    await Promise.all([
      qc.invalidateQueries({ queryKey: profileKeys.panelPhotos() }),
      qc.invalidateQueries({ queryKey: chatKeys.all }),
    ]);
    await refreshUser();
  }

  const label = (text: string, hint?: string) => (
    <span className="mb-1 block text-sm font-medium text-gray-700">
      {text} {hint && <span className="font-normal text-gray-400">{hint}</span>}
    </span>
  );

  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
          <UserRound className="h-5 w-5 text-emerald-700" aria-hidden="true" /> My profile
        </h1>
        <p className="mt-1 text-sm text-gray-600">Your photo and name show in the panel, Team Chat and Tasks.</p>

        <div className="mt-5">
          <PhotoEditor name={form.name || data.name} photoUrl={data.avatar.url} onChanged={photoChanged}
            faceClassName="bg-emerald-100 text-emerald-800" buttonClassName="border-gray-300 text-gray-700 hover:bg-gray-50" />
        </div>

        <form onSubmit={submit} className="mt-6 grid gap-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            {label('Name')}
            <input className={input} value={form.name} onChange={set('name')} required maxLength={80} autoComplete="name" />
          </label>
          <div>
            {label('Email')}
            <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">{data.email}</p>
          </div>
          <div>
            {label('Team')}
            <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">{data.teamLabel || '—'} <span className="text-gray-400">· set by an admin</span></p>
          </div>
          <label className="block">
            {label('Phone')}
            <input className={input} value={form.phone} onChange={set('phone')} inputMode="tel" maxLength={16} autoComplete="tel" placeholder="98765 43210" />
          </label>
          <label className="block">
            {label('Job title')}
            <input className={input} value={form.jobTitle} onChange={set('jobTitle')} maxLength={60} placeholder="Sales Executive" />
          </label>
          <label className="block">
            {label('Date of birth', '(optional)')}
            <input className={input} type="date" value={form.dateOfBirth} onChange={set('dateOfBirth')} max={todayIso()} min="1900-01-01" />
          </label>
          <div className="hidden sm:block" />
          <label className="block">
            {label('Emergency contact name', '(optional)')}
            <input className={input} value={form.ecName} onChange={set('ecName')} maxLength={60} placeholder="Ravi (brother)" />
          </label>
          <label className="block">
            {label('Emergency contact phone', '(optional)')}
            <input className={input} value={form.ecPhone} onChange={set('ecPhone')} inputMode="tel" maxLength={16} placeholder="98400 12345" />
          </label>
          <label className="block sm:col-span-2">
            {label('Short bio', `(optional · ${form.bio.length}/200)`)}
            <textarea className={input} rows={3} value={form.bio} onChange={set('bio')} maxLength={200} placeholder="What you look after, e.g. Chennai sales leads." />
          </label>

          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2">{error}</p>}
          {saved && <p role="status" className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800 sm:col-span-2">Saved.</p>}

          <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2">
            {passwordHref && !user?.username ? (
              <Link href={passwordHref} className="text-sm font-medium text-emerald-700 hover:underline">Change password</Link>
            ) : <span />}
            <button type="submit" disabled={busy} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50">
              {busy ? 'Saving…' : 'Save profile'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
