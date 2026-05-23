'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import Link from 'next/link';
import apiClient from '@/lib/api';
import { Loader2, ArrowLeft, CheckCircle, AlertCircle } from 'lucide-react';

function ResetPasswordPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState<'verifying' | 'valid' | 'invalid' | 'submitting' | 'success' | 'error'>('verifying');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const verifyToken = async () => {
      if (!token) {
        setStatus('invalid');
        setErrorMessage('Missing reset token.');
        return;
      }
      try {
        await apiClient.get(`/auth/verify-reset-token?token=${token}`);
        setStatus('valid');
      } catch (error: any) {
        setStatus('invalid');
        setErrorMessage(error.message || 'Invalid or expired reset token.');
      }
    };
    verifyToken();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setStatus('error');
      setErrorMessage('Passwords do not match');
      return;
    }
    if (password.length < 6) {
      setStatus('error');
      setErrorMessage('Password must be at least 6 characters');
      return;
    }
    setStatus('submitting');
    setErrorMessage('');
    try {
      await apiClient.post('/auth/reset-password', { token, password });
      setStatus('success');
    } catch (error: any) {
      setStatus('error');
      setErrorMessage(error.message || 'Failed to reset password. Please try again.');
    }
  };

  const inputClass = 'w-full bg-[#161616] border border-[#252525] text-white placeholder:text-[#555555] rounded-sm px-4 py-2.5 focus:outline-none focus:border-[#3B9EE8] font-body text-sm transition-colors';

  if (status === 'verifying') {
    return (
      <div className="min-h-screen bg-[#080808] flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto h-12 w-12 text-[#3B9EE8] animate-spin" />
          <h2 className="mt-4 text-xl font-condensed font-bold text-white uppercase tracking-wide">Verifying link...</h2>
        </div>
      </div>
    );
  }

  if (status === 'invalid') {
    return (
      <div className="min-h-screen bg-[#080808] flex items-center justify-center py-12 px-4">
        <div className="max-w-md w-full text-center">
          <div className="bg-red-500/10 border border-red-500/30 rounded-sm p-8 mb-6">
            <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
            <h3 className="font-condensed font-bold text-white uppercase tracking-wide text-xl mb-2">Invalid Link</h3>
            <p className="text-[#C4C4C4] font-body text-sm mb-6">{errorMessage}</p>
            <Link
              href="/forgot-password"
              className="inline-block bg-[#3B9EE8] hover:bg-[#1A6FB5] text-white font-condensed font-bold uppercase tracking-widest px-6 py-2.5 rounded-sm transition-colors text-sm"
            >
              Request New Reset Link
            </Link>
          </div>
          <Link href="/login" className="font-condensed font-bold text-[#3B9EE8] hover:text-white uppercase tracking-widest text-sm flex items-center justify-center gap-1 transition-colors">
            <ArrowLeft className="h-4 w-4" /> Back to Login
          </Link>
        </div>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="min-h-screen bg-[#080808] flex items-center justify-center py-12 px-4">
        <div className="max-w-md w-full text-center">
          <div className="bg-green-500/10 border border-green-500/30 rounded-sm p-8">
            <CheckCircle className="h-12 w-12 text-green-400 mx-auto mb-4" />
            <h3 className="font-condensed font-bold text-white uppercase tracking-wide text-xl mb-2">Password Reset Successful</h3>
            <p className="text-[#C4C4C4] font-body text-sm mb-6">
              Your password has been successfully updated. You can now log in with your new password.
            </p>
            <Link
              href="/login"
              className="inline-block bg-[#3B9EE8] hover:bg-[#1A6FB5] text-white font-condensed font-bold uppercase tracking-widest px-8 py-3 rounded-sm transition-colors"
            >
              Sign In
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#080808] flex items-center justify-center py-12 px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <p className="text-[#3B9EE8] font-condensed font-bold text-sm uppercase tracking-widest mb-2">Security</p>
          <h2 className="text-3xl font-condensed font-bold text-white uppercase tracking-wide">Reset Password</h2>
          <p className="mt-2 text-[#C4C4C4] font-body text-sm">Please enter your new password below.</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-[#0E0E0E] border border-[#252525] rounded-sm p-6 space-y-4">
          {status === 'error' && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-sm p-3 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
              <p className="text-red-300 font-body text-sm">{errorMessage}</p>
            </div>
          )}

          <div>
            <label htmlFor="password" className="block text-xs font-condensed font-bold text-[#555555] uppercase tracking-widest mb-1">
              New Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              placeholder="At least 6 characters"
            />
          </div>

          <div>
            <label htmlFor="confirmPassword" className="block text-xs font-condensed font-bold text-[#555555] uppercase tracking-widest mb-1">
              Confirm Password
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={inputClass}
              placeholder="Confirm your new password"
            />
          </div>

          <button
            type="submit"
            disabled={status === 'submitting'}
            className="w-full bg-[#3B9EE8] hover:bg-[#1A6FB5] text-white font-condensed font-bold uppercase tracking-widest py-3 rounded-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors mt-2"
          >
            {status === 'submitting' ? (
              <><Loader2 className="animate-spin h-4 w-4" /> Resetting...</>
            ) : (
              'Reset Password'
            )}
          </button>
        </form>

        <div className="mt-6 text-center">
          <Link href="/login" className="font-condensed font-bold text-[#3B9EE8] hover:text-white uppercase tracking-widest text-sm flex items-center justify-center gap-1 transition-colors">
            <ArrowLeft className="h-4 w-4" /> Back to Login
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#080808]" />}>
      <ResetPasswordPageInner />
    </Suspense>
  );
}
