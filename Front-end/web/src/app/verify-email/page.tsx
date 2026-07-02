'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense } from 'react';
import Link from 'next/link';
import apiClient from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';

function VerifyEmailPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { checkAuth } = useAuth();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [message, setMessage] = useState('');
  const [resendEmail, setResendEmail] = useState('');
  const [resendSent, setResendSent] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);

  useEffect(() => {
    const verifyEmail = async () => {
      if (!token) {
        setStatus('error');
        setMessage('Verification token is missing.');
        return;
      }
      try {
        await apiClient.get(`/auth/verify-email?token=${token}`);
        // Refresh auth state so AuthContext reflects isVerified: true immediately
        await checkAuth();
        setStatus('success');
        setTimeout(() => router.push('/'), 3000);
      } catch (error: any) {
        setStatus('error');
        setMessage(error.message || 'The link may be invalid or expired.');
      }
    };
    verifyEmail();
  }, [token, checkAuth, router]);

  const handleResend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resendEmail) return;
    setResendLoading(true);
    try {
      await apiClient.post('/auth/resend-verification', { email: resendEmail });
      setResendSent(true);
    } catch {
      setResendSent(true); // generic — don't leak enumeration
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-obsidian-deep flex items-center justify-center py-12 px-4">
      <div className="max-w-md w-full text-center">
        {status === 'verifying' && (
          <div className="flex flex-col items-center">
            <Loader2 className="h-12 w-12 text-gold animate-spin mb-4" />
            <h2 className="text-xl font-display font-light text-ink tracking-[-0.01em]">Verifying your email...</h2>
            <p className="mt-2 text-ink/70 font-display text-sm">Please wait while we confirm your email address.</p>
          </div>
        )}

        {status === 'success' && (
          <div className="bg-green-500/10 border border-green-500/30 rounded-sm p-8">
            <CheckCircle className="h-12 w-12 text-green-400 mx-auto mb-4" />
            <h3 className="font-display font-light text-ink tracking-[-0.01em] text-xl mb-2">Email Verified!</h3>
            <p className="text-ink/70 font-display text-sm mb-6">
              Your email has been verified. Redirecting you now...
            </p>
            <Link
              href="/"
              className="inline-block bg-gold hover:opacity-90 text-obsidian font-display font-bold uppercase tracking-widest px-8 py-3 rounded-sm transition-colors"
            >
              Continue Shopping
            </Link>
          </div>
        )}

        {status === 'error' && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-sm p-8">
            <XCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
            <h3 className="font-display font-light text-ink tracking-[-0.01em] text-xl mb-2">Verification Failed</h3>
            <p className="text-ink/70 font-display text-sm mb-6">{message}</p>

            {resendSent ? (
              <p className="text-sm text-green-400 font-display">
                If that email exists and is unverified, a new link has been sent. Check your inbox.
              </p>
            ) : (
              <form onSubmit={handleResend} className="mt-4 text-left space-y-3">
                <p className="text-xs text-ink/70 font-display uppercase tracking-widest">Resend verification link</p>
                <input
                  type="email"
                  required
                  placeholder="your@email.com"
                  value={resendEmail}
                  onChange={e => setResendEmail(e.target.value)}
                  className="w-full px-3 py-2 bg-obsidian-raised text-ink border border-hairline rounded-sm focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold transition-colors font-display placeholder:text-ink-muted text-sm"
                />
                <button
                  type="submit"
                  disabled={resendLoading}
                  className="w-full bg-gold hover:opacity-90 disabled:opacity-50 text-obsidian font-display font-bold uppercase tracking-widest px-6 py-2 rounded-sm transition-colors text-sm flex items-center justify-center gap-2"
                >
                  {resendLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  Send New Link
                </button>
                <Link
                  href="/login"
                  className="block text-center font-display font-bold text-gold hover:text-ink uppercase tracking-widest text-xs transition-colors mt-2"
                >
                  Return to Login
                </Link>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-obsidian-deep" />}>
      <VerifyEmailPageInner />
    </Suspense>
  );
}
