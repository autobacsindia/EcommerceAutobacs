'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import apiClient from '@/lib/api-client';

type ExchangeCodeResponse = {
  success: boolean;
  message?: string;
  user?: {
    id: string;
    _id: string;
    name: string;
    email: string;
    role: string;
    isVerified: boolean;
    sessionVersion: number;
  };
};

export default function SocialCallbackPage() {
  const router = useRouter();
  const { checkAuth, hydrateFromExchange } = useAuth();
  const [status, setStatus] = useState<'loading' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState<string>('');
  // Guard against React Strict Mode double-invoke
  const didRun = useRef(false);

  useEffect(() => {
    if (didRun.current) return;
    didRun.current = true;

    const handleCallback = async () => {
      try {
        console.log('[Social Callback] Starting callback handler');
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');

        console.log('[Social Callback] Code from URL:', code ? `${code.substring(0, 10)}...` : 'NOT FOUND');

        // ── Secure path: one-time code exchange (PKCE-lite) ─────────────────
        if (code) {
          console.log('[Social Callback] Attempting code exchange...');
          // Use apiClient which automatically handles CSRF tokens
          const data = await apiClient.post<ExchangeCodeResponse>('/auth/exchange-code', { code });
          
          console.log('[Social Callback] Exchange response:', data);
          
          if (!data.success) {
            console.error('[Social Callback] Code exchange failed:', data.message);
            throw new Error(data.message || 'Code exchange failed');
          }
          
          console.log('[Social Callback] Code exchange successful, hydrating auth state...');
          if (data.user) {
            // Backend returned user data — hydrate directly, no extra /me round-trip.
            hydrateFromExchange(data.user);
          } else {
            // Fallback: backend didn't return user data (older deploy), fetch it.
            await checkAuth();
          }
          console.log('[Social Callback] Auth hydrated, redirecting to home');
          router.replace('/');
          return;
        }

        // ── Legacy fallback: hash-fragment (no Redis / local dev) ────────────
        console.log('[Social Callback] No code found, checking hash fragment...');
        const hash = window.location.hash.startsWith('#')
          ? window.location.hash.substring(1)
          : window.location.hash;
        const hashParams = new URLSearchParams(hash);
        const accessToken = hashParams.get('accessToken');

        if (!accessToken) {
          console.error('[Social Callback] No authentication data received');
          setErrorMsg('No authentication data received.');
          setStatus('error');
          return;
        }

        // Legacy path: set token (deprecated - should use cookie exchange)
        console.warn('[Social Callback] Using legacy hash-based auth (deprecated)');
        apiClient.setAuthToken(accessToken);
        await checkAuth();
        router.replace('/');
      } catch (error) {
        console.error('[Social Callback] Callback failed:', error);
        setErrorMsg(
          error instanceof Error ? error.message : 'An unexpected error occurred.'
        );
        setStatus('error');
      }
    };

    handleCallback();
  }, [checkAuth, hydrateFromExchange, router]);

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
            <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-6">
              <p className="text-sm text-red-800 font-medium">
                Authentication Failed
              </p>
              <p className="text-sm text-red-700 mt-1">
                {errorMsg || 'We could not complete your social login. Please try again or use email and password to sign in.'}
              </p>
            </div>
            <button
              onClick={() => router.push('/login')}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Back to Login
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
