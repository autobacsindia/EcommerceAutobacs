'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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
        console.error('Email verification failed:', error);
        setStatus('error');
        setMessage(error.message || 'Failed to verify email. The token may be invalid or expired.');
      }
    };

    verifyEmail();
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8 text-center">
        {status === 'verifying' && (
          <div className="flex flex-col items-center">
            <Loader2 className="h-12 w-12 text-blue-600 animate-spin mb-4" />
            <h2 className="text-xl font-semibold text-gray-900">Verifying your email...</h2>
            <p className="mt-2 text-sm text-gray-600">Please wait while we confirm your email address.</p>
          </div>
        )}

        {status === 'success' && (
          <div className="rounded-md bg-green-50 p-6 border border-green-200">
            <div className="flex justify-center mb-4">
              <CheckCircle className="h-12 w-12 text-green-500" />
            </div>
            <h3 className="text-xl font-medium text-green-900">Email Verified!</h3>
            <p className="mt-2 text-sm text-green-700">
              Your email address has been successfully verified. You can now access all features of your account.
            </p>
            <div className="mt-6">
              <Link
                href="/login"
                className="w-full flex justify-center items-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Sign In
              </Link>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="rounded-md bg-red-50 p-6 border border-red-200">
            <div className="flex justify-center mb-4">
              <XCircle className="h-12 w-12 text-red-500" />
            </div>
            <h3 className="text-xl font-medium text-red-900">Verification Failed</h3>
            <p className="mt-2 text-sm text-red-700">{message}</p>
            <div className="mt-6">
              <Link
                href="/login"
                className="font-medium text-blue-600 hover:text-blue-500"
              >
                Return to Login
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <VerifyEmailPageInner />
    </Suspense>
  );
}
