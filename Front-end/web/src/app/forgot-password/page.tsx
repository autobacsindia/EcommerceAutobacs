'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import apiClient from '@/lib/api';
import { Loader2, ArrowLeft, Mail } from 'lucide-react';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  // Migrated WooCommerce customers (ADR-005) are routed here from login to set a first password.
  const [migrated, setMigrated] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const e = params.get('email');
    if (e) setEmail(e);
    setMigrated(params.get('migrated') === '1');
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setStatus('loading');
    setErrorMessage('');
    try {
      await apiClient.post('/auth/forgot-password', { email });
      setStatus('success');
    } catch (error: any) {
      setStatus('error');
      setErrorMessage(error.message || 'Failed to send password reset email. Please try again.');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-obsidian-deep py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <p className="font-display text-[10px] uppercase tracking-[0.28em] text-gold mb-2">Account</p>
          <h2 className="text-3xl font-display font-light text-ink tracking-[-0.01em]">
            {migrated ? 'Set Your Password' : 'Forgot Password'}
          </h2>
          <p className="mt-2 text-sm text-ink/70 font-display">
            {migrated
              ? 'Welcome back! Your account moved to our new site. Enter your email and we’ll send a link to set a password — your details and orders are safe.'
              : 'Enter your email address and we’ll send you a link to reset your password.'}
          </p>
        </div>

        {status === 'success' ? (
          <div className="bg-green-500/10 border border-green-500/30 rounded-sm p-5">
            <div className="flex gap-3">
              <Mail className="h-5 w-5 text-green-400 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-display font-bold text-green-400 uppercase tracking-wide">Check Your Email</h3>
                <p className="mt-2 text-sm text-green-300/80 font-display">
                  If an account exists for {email}, we have sent a password reset link to it.
                  Please check your inbox and spam folder.
                </p>
                <Link href="/login" className="mt-4 inline-flex items-center gap-1 text-sm font-display font-bold text-green-400 hover:text-ink transition-colors uppercase tracking-widest">
                  <ArrowLeft className="h-4 w-4" />
                  Back to Login
                </Link>
              </div>
            </div>
          </div>
        ) : (
          <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
            {status === 'error' && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-sm p-4">
                <p className="text-sm text-red-400 font-display">{errorMessage}</p>
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-xs font-display font-bold text-ink-muted uppercase tracking-widest mb-1">
                Email Address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-obsidian-raised border border-hairline text-ink placeholder:text-ink-muted rounded-sm px-4 py-2.5 focus:outline-none focus:border-gold font-display text-sm transition-colors"
                placeholder="you@example.com"
              />
            </div>

            <button
              type="submit"
              disabled={status === 'loading'}
              className="w-full flex justify-center items-center py-3 px-4 bg-gold hover:opacity-90 text-obsidian font-display font-bold uppercase tracking-widest rounded-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {status === 'loading' ? (
                <><Loader2 className="animate-spin -ml-1 mr-2 h-4 w-4" />Sending...</>
              ) : (
                'Send Reset Link'
              )}
            </button>

            <div className="flex items-center justify-center">
              <Link href="/login" className="inline-flex items-center gap-1 font-display font-bold text-gold hover:text-ink text-sm uppercase tracking-widest transition-colors">
                <ArrowLeft className="h-4 w-4" />
                Back to Login
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
