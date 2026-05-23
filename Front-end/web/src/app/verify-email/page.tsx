'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import Link from 'next/link';
import apiClient from '@/lib/api';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';

function VerifyEmailPageInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const verifyEmail = async () => {
      if (!token) {
        setStatus('error');
        setMessage('Verification token is missing.');
        return;
      }
      try {
        await apiClient.get(`/auth/verify-email?token=${token}`);
        setStatus('success');
      } catch (error: any) {
        setStatus('error');
        setMessage(error.message || 'Failed to verify email. The token may be invalid or expired.');
      }
    };
    verifyEmail();
  }, [token]);

  return (
    <div className="min-h-screen bg-[#080808] flex items-center justify-center py-12 px-4">
      <div className="max-w-md w-full text-center">
        {status === 'verifying' && (
          <div className="flex flex-col items-center">
            <Loader2 className="h-12 w-12 text-[#3B9EE8] animate-spin mb-4" />
            <h2 className="text-xl font-condensed font-bold text-white uppercase tracking-wide">Verifying your email...</h2>
            <p className="mt-2 text-[#C4C4C4] font-body text-sm">Please wait while we confirm your email address.</p>
          </div>
        )}

        {status === 'success' && (
          <div className="bg-green-500/10 border border-green-500/30 rounded-sm p-8">
            <CheckCircle className="h-12 w-12 text-green-400 mx-auto mb-4" />
            <h3 className="font-condensed font-bold text-white uppercase tracking-wide text-xl mb-2">Email Verified!</h3>
            <p className="text-[#C4C4C4] font-body text-sm mb-6">
              Your email address has been successfully verified. You can now access all features of your account.
            </p>
            <Link
              href="/login"
              className="inline-block bg-[#3B9EE8] hover:bg-[#1A6FB5] text-white font-condensed font-bold uppercase tracking-widest px-8 py-3 rounded-sm transition-colors"
            >
              Sign In
            </Link>
          </div>
        )}

        {status === 'error' && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-sm p-8">
            <XCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
            <h3 className="font-condensed font-bold text-white uppercase tracking-wide text-xl mb-2">Verification Failed</h3>
            <p className="text-[#C4C4C4] font-body text-sm mb-6">{message}</p>
            <Link
              href="/login"
              className="font-condensed font-bold text-[#3B9EE8] hover:text-white uppercase tracking-widest text-sm transition-colors"
            >
              Return to Login
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#080808]" />}>
      <VerifyEmailPageInner />
    </Suspense>
  );
}
