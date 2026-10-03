'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { brand } from '@/components/home/redesign/homeContent';

type InviteInfo = { name: string; email: string; teamLabel: string; isHead: boolean; existingAccount: boolean };

const errorMessage = (e: unknown, fallback: string) =>
  (e as { rawData?: { message?: string } })?.rawData?.message || fallback;

const inputClass =
  'w-full px-3 py-2 bg-obsidian-raised text-ink border border-hairline rounded-sm focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold font-display';
const labelClass = 'block text-sm font-display font-bold text-ink/70 uppercase tracking-widest mb-1';

/**
 * Staff invite redemption: the invitee sets a password, which activates their
 * team access. The emailed one-time link is the only way in.
 */
function StaffInviteInner() {
  const token = useSearchParams().get('token') || '';
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [loadError, setLoadError] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) { setLoadError('This invite link is incomplete. Open the link from your email again.'); return; }
    apiClient.get<{ invite: InviteInfo }>(`/staff/invites/verify?token=${encodeURIComponent(token)}`)
      .then((res) => setInvite(res.invite))
      .catch((e) => setLoadError(errorMessage(e, 'This invite link is invalid or has expired.')));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError('');
    if (password.length < 8) { setSubmitError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setSubmitError('The two passwords do not match.'); return; }
    setBusy(true);
    try {
      await apiClient.post('/staff/invites/accept', { token, password });
      setDone(true);
    } catch (err) {
      setSubmitError(errorMessage(err, 'Could not activate your access. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-obsidian-deep flex flex-col items-center px-4">
      <div className="py-8">
        <Link href="/" className="block">
          <Image src={brand.logo} alt="Roavion" width={960} height={255} priority className="h-16 w-auto object-contain" />
        </Link>
      </div>

      <div className="w-full max-w-100 rounded-lg border border-hairline bg-obsidian p-6 sm:p-8">
        {loadError ? (
          <div className="flex items-start gap-2 text-sm text-red-400 font-display">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" /> {loadError}
          </div>
        ) : !invite ? (
          <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-ink-muted" /></div>
        ) : done ? (
          <div className="space-y-4 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-green-500" />
            <h1 className="text-2xl font-display font-light text-ink">Your access is active</h1>
            <p className="text-sm text-ink/70 font-display">Sign in with {invite.email} and your new password.</p>
            <Link
              href="/login?redirect=/team"
              className="block w-full rounded-sm bg-gold py-2.5 text-center font-display font-bold uppercase tracking-widest text-obsidian hover:opacity-90"
            >
              Sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <h1 className="text-2xl font-display font-light text-ink">Join the {invite.teamLabel} team</h1>
              <p className="mt-1 text-sm text-ink/70 font-display">
                Hi {invite.name}, set a password to activate your access as {invite.isHead ? 'team head' : 'a team member'}.
              </p>
              {invite.existingAccount && (
                <p className="mt-2 text-xs text-ink-muted font-display">
                  You already have an account with this email. Your order history stays; this password replaces your old one.
                </p>
              )}
            </div>

            <div>
              <label className={labelClass}>Email</label>
              <input value={invite.email} readOnly className={`${inputClass} opacity-70`} />
            </div>
            <div>
              <label htmlFor="pw" className={labelClass}>New password</label>
              <input id="pw" type="password" autoComplete="new-password" minLength={8} maxLength={72} required
                value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label htmlFor="pw2" className={labelClass}>Confirm password</label>
              <input id="pw2" type="password" autoComplete="new-password" minLength={8} maxLength={72} required
                value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} />
            </div>

            {submitError && (
              <p className="flex items-start gap-1 text-sm text-red-400 font-display">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {submitError}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="flex w-full items-center justify-center rounded-sm bg-gold py-2.5 font-display font-bold uppercase tracking-widest text-obsidian hover:opacity-90 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Activate access'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// useSearchParams() needs a Suspense boundary on a statically generated page.
export default function StaffInvitePage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <StaffInviteInner />
    </Suspense>
  );
}
