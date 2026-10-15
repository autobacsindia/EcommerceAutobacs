'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { useAuth } from '@/context/AuthContext';

/**
 * Change my password. Required the first time a company account signs in, and
 * after an admin or team head resets it — the password they chose was only ever
 * meant to get the person here. Every other device is signed out; this one stays.
 */
export default function ChangePasswordPage() {
  const router = useRouter();
  const { checkAuth } = useAuth();
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (form.next !== form.confirm) {
      setError('The two new passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await apiClient.post('/staff/password', { currentPassword: form.current, newPassword: form.next });
      setDone(true);
      await checkAuth();
      // A full reload, so the server layout re-reads the session and lifts the lock.
      router.replace('/team');
      router.refresh();
    } catch (err) {
      setError((err as { rawData?: { message?: string; errors?: { msg?: string }[] } })?.rawData?.errors?.[0]?.msg
        || (err as { rawData?: { message?: string } })?.rawData?.message
        || 'Could not change the password. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const field = (key: keyof typeof form, label: string, autoComplete: string) => (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      <input
        type="password"
        required
        minLength={key === 'current' ? 1 : 8}
        maxLength={72}
        autoComplete={autoComplete}
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />
    </label>
  );

  return (
    <div className="mx-auto max-w-md">
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
          <KeyRound className="h-5 w-5 text-blue-600" /> Choose your password
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          Use one only you know — at least 8 characters. You will stay signed in here; other devices are signed out.
        </p>
        {done ? (
          <p className="mt-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800" role="status">Password changed. Opening your panel…</p>
        ) : (
          <form onSubmit={submit} className="mt-4 space-y-3">
            {field('current', 'Current password (the one you were given)', 'current-password')}
            {field('next', 'New password', 'new-password')}
            {field('confirm', 'New password again', 'new-password')}
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
