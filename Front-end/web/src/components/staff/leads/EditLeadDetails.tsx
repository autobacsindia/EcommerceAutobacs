'use client';

/**
 * "Edit details" on a website lead: fix the name, phone or e-mail.
 *
 * Shown only to people the server lets see the phone (the person following up,
 * the GTM head, admin) — the server re-checks. Sends what the form opened with
 * (`seen`), so if someone else saved in between the server answers 409 with
 * their version instead of overwriting it.
 */

import { useState } from 'react';
import apiClient from '@/lib/api-client';

export type LeadContact = { name: string; phone: string | null; email: string | null };

type Result<L> = { success?: boolean; outcome?: string; message?: string; lead: L };

export default function EditLeadDetails<L>({ leadId, contact, onSaved, onConflict, onCancel }: {
  leadId: string;
  contact: LeadContact;
  onSaved: (res: Result<L>) => void;
  /** Someone saved first: their version, plus the message to show. */
  onConflict: (res: Result<L>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(contact.name ?? '');
  const [phone, setPhone] = useState(contact.phone ?? '');
  const [email, setEmail] = useState(contact.email ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const res = await apiClient.patch<Result<L>>(`/staff/leads/${encodeURIComponent(leadId)}`, {
        name, phone, email,
        seen: { name: contact.name ?? '', phone: contact.phone ?? '', email: contact.email ?? '' },
      });
      onSaved(res);
    } catch (err) {
      const body = (err as { rawData?: Result<L> })?.rawData;
      if (body?.lead) onConflict(body);
      else setError(body?.message || 'Could not save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const input = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm';
  return (
    <form onSubmit={submit} aria-label="Edit lead details" className="mt-3 space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
      <label className="block text-sm"><span className="text-gray-700">Name</span>
        <input className={input} value={name} maxLength={120} onChange={(ev) => setName(ev.target.value)} />
      </label>
      <label className="block text-sm"><span className="text-gray-700">Phone</span>
        <input className={input} value={phone} inputMode="tel" maxLength={20} onChange={(ev) => setPhone(ev.target.value)} />
      </label>
      <label className="block text-sm"><span className="text-gray-700">E-mail</span>
        <input className={input} value={email} type="email" maxLength={254} onChange={(ev) => setEmail(ev.target.value)} />
      </label>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
          {saving ? 'Saving…' : 'Save details'}
        </button>
        <button type="button" disabled={saving} onClick={onCancel} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm">Cancel</button>
      </div>
    </form>
  );
}
