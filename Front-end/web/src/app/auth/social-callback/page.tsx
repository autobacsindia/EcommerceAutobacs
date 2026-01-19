'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import apiClient from '@/lib/api';

export default function SocialCallbackPage() {
  const router = useRouter();
  const { checkAuth } = useAuth();
  const [status, setStatus] = useState<'loading' | 'error'>('loading');

  useEffect(() => {
    const handleCallback = async () => {
      try {
        if (typeof window === 'undefined') {
          return;
        }

        const hash = window.location.hash.startsWith('#')
          ? window.location.hash.substring(1)
          : window.location.hash;

        const params = new URLSearchParams(hash);
        const accessToken = params.get('accessToken');

        if (!accessToken) {
          setStatus('error');
          return;
        }

        apiClient.setAuthToken(accessToken);

        await checkAuth();

        router.replace('/');
      } catch (error) {
        console.error('Social login callback failed:', error);
        setStatus('error');
      }
    };

    handleCallback();
  }, [checkAuth, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-6 text-center">
        <h2 className="text-2xl font-semibold text-gray-900">
          Completing social sign-in
        </h2>
        {status === 'loading' ? (
          <p className="text-sm text-gray-600">
            Please wait while we finalize your login.
          </p>
        ) : (
          <div>
            <p className="text-sm text-red-600 mb-2">
              We could not complete your social login.
            </p>
            <p className="text-sm text-gray-600">
              Please try again or use email and password to sign in.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

