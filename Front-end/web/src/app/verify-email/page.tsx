'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Mail, Loader2, CheckCircle, AlertCircle, XCircle, Info } from 'lucide-react';
import { apiClient } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { checkAuth } = useAuth();
  const token = searchParams.get('token');

  const [isVerifying, setIsVerifying] = useState(true);
  const [verificationStatus, setVerificationStatus] = useState<
    'success' | 'expired' | 'invalid' | 'already-verified' | 'error'
  >('success');
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(3);
  const [isResending, setIsResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  useEffect(() => {
    const verifyEmail = async () => {
      if (!token) {
        setVerificationStatus('invalid');
        setError('No verification token provided');
        setIsVerifying(false);
        return;
      }

      try {
        const response = await apiClient.get(`/auth/verify-email?token=${token}`);
        
        if (response.success) {
          setVerificationStatus('success');
          // Refresh user data to update verification status
          await checkAuth();
          // Start countdown for redirect
          startCountdown();
        } else {
          setError(response.message || 'Verification failed');
          setVerificationStatus('error');
        }
      } catch (err: any) {
        const errorMessage = err.message || 'Verification failed';
        setError(errorMessage);

        // Determine error type from message
        if (errorMessage.toLowerCase().includes('expired')) {
          setVerificationStatus('expired');
        } else if (errorMessage.toLowerCase().includes('already verified')) {
          setVerificationStatus('already-verified');
        } else if (errorMessage.toLowerCase().includes('invalid')) {
          setVerificationStatus('invalid');
        } else {
          setVerificationStatus('error');
        }

        console.error('Email verification error:', err);
      } finally {
        setIsVerifying(false);
      }
    };

    verifyEmail();
  }, [token, checkAuth]);

  const startCountdown = () => {
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          router.push('/');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleResendVerification = async () => {
    try {
      setIsResending(true);
      setResendMessage(null);

      const response = await apiClient.post('/auth/resend-verification', {});

      if (response.success) {
        setResendMessage('Verification email sent! Please check your inbox.');
      } else {
        setResendMessage(response.message || 'Failed to resend verification email');
      }
    } catch (err: any) {
      setResendMessage(err.message || 'Failed to resend verification email');
    } finally {
      setIsResending(false);
    }
  };

  // Verifying state
  if (isVerifying) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="mx-auto h-12 w-12 text-blue-600 animate-spin mb-4" />
          <p className="text-gray-600 text-lg">Verifying your email...</p>
          <p className="text-gray-500 text-sm mt-2">Please wait a moment</p>
        </div>
      </div>
    );
  }

  // Success state
  if (verificationStatus === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">
        <div className="max-w-md w-full bg-white shadow-md rounded-lg p-8 text-center">
          <CheckCircle className="mx-auto h-16 w-16 text-green-500 mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Email Verified Successfully!</h2>
          <p className="text-gray-600 mb-6">
            Your email address has been verified. You now have full access to all Autobacs features.
          </p>
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
            <p className="text-sm text-green-800 font-medium mb-2">
              ✨ What's unlocked:
            </p>
            <ul className="text-sm text-green-700 space-y-1 text-left">
              <li>• Full access to your account</li>
              <li>• Order tracking and history</li>
              <li>• Wishlist and saved items</li>
              <li>• Exclusive deals and offers</li>
            </ul>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-6">
            <p className="text-sm text-blue-800">
              Redirecting to home page in <strong>{countdown}</strong> seconds...
            </p>
          </div>
          <Link
            href="/"
            className="inline-block w-full px-4 py-3 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 transition-colors"
          >
            Continue to Home
          </Link>
        </div>
      </div>
    );
  }

  // Already verified state
  if (verificationStatus === 'already-verified') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">
        <div className="max-w-md w-full bg-white shadow-md rounded-lg p-8 text-center">
          <Info className="mx-auto h-16 w-16 text-blue-500 mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Email Already Verified</h2>
          <p className="text-gray-600 mb-6">
            Your email address has already been verified. You're all set!
          </p>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <p className="text-sm text-blue-800">
              You have full access to your account and all Autobacs features.
            </p>
          </div>
          <Link
            href="/login"
            className="inline-block w-full px-4 py-3 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 transition-colors mb-3"
          >
            Go to Login
          </Link>
          <Link
            href="/"
            className="inline-block text-sm text-blue-600 hover:text-blue-700"
          >
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  // Expired token state
  if (verificationStatus === 'expired') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">
        <div className="max-w-md w-full bg-white shadow-md rounded-lg p-8 text-center">
          <AlertCircle className="mx-auto h-16 w-16 text-yellow-500 mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Verification Link Expired</h2>
          <p className="text-gray-600 mb-6">
            {error || 'This verification link has expired. Verification links are valid for 24 hours.'}
          </p>
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
            <p className="text-sm text-yellow-800">
              Don't worry! You can request a new verification email below.
            </p>
          </div>
          
          {resendMessage && (
            <div className={`mb-4 p-3 rounded-lg ${
              resendMessage.toLowerCase().includes('sent') 
                ? 'bg-green-50 border border-green-200 text-green-800' 
                : 'bg-red-50 border border-red-200 text-red-800'
            }`}>
              <p className="text-sm">{resendMessage}</p>
            </div>
          )}
          
          <button
            onClick={handleResendVerification}
            disabled={isResending}
            className="w-full px-4 py-3 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed mb-3"
          >
            {isResending ? (
              <>
                <Loader2 className="inline-block mr-2 h-4 w-4 animate-spin" />
                Sending...
              </>
            ) : (
              'Resend Verification Email'
            )}
          </button>
          <Link
            href="/login"
            className="inline-block text-sm text-blue-600 hover:text-blue-700"
          >
            Back to Login
          </Link>
        </div>
      </div>
    );
  }

  // Invalid token or error state
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">
      <div className="max-w-md w-full bg-white shadow-md rounded-lg p-8 text-center">
        <XCircle className="mx-auto h-16 w-16 text-red-500 mb-4" />
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Verification Failed</h2>
        <p className="text-gray-600 mb-6">
          {error || 'The verification link is invalid or has already been used.'}
        </p>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <p className="text-sm text-red-800">
            <strong>Possible reasons:</strong>
          </p>
          <ul className="text-sm text-red-700 mt-2 space-y-1 text-left">
            <li>• The link is invalid or malformed</li>
            <li>• The link has already been used</li>
            <li>• The verification token has expired</li>
          </ul>
        </div>
        
        {resendMessage && (
          <div className={`mb-4 p-3 rounded-lg ${
            resendMessage.toLowerCase().includes('sent') 
              ? 'bg-green-50 border border-green-200 text-green-800' 
              : 'bg-red-50 border border-red-200 text-red-800'
          }`}>
            <p className="text-sm">{resendMessage}</p>
          </div>
        )}
        
        <button
          onClick={handleResendVerification}
          disabled={isResending}
          className="w-full px-4 py-3 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed mb-3"
        >
          {isResending ? (
            <>
              <Loader2 className="inline-block mr-2 h-4 w-4 animate-spin" />
              Sending...
            </>
          ) : (
            'Request New Verification Email'
          )}
        </button>
        <Link
          href="/"
          className="inline-block text-sm text-blue-600 hover:text-blue-700"
        >
          Back to Home
        </Link>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-12 w-12 text-blue-600 animate-spin" />
      </div>
    }>
      <VerifyEmailContent />
    </Suspense>
  );
}
'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Mail, Loader2, CheckCircle, AlertCircle, XCircle, Info } from 'lucide-react';
import { apiClient } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { checkAuth } = useAuth();
  const token = searchParams.get('token');

  const [isVerifying, setIsVerifying] = useState(true);
  const [verificationStatus, setVerificationStatus] = useState<
    'success' | 'expired' | 'invalid' | 'already-verified' | 'error'
  >('success');
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(3);
  const [isResending, setIsResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  useEffect(() => {
    const verifyEmail = async () => {
      if (!token) {
        setVerificationStatus('invalid');
        setError('No verification token provided');
        setIsVerifying(false);
        return;
      }

      try {
        const response = await apiClient.get(`/auth/verify-email?token=${token}`);
        
        if (response.success) {
          setVerificationStatus('success');
          // Refresh user data to update verification status
          await checkAuth();
          // Start countdown for redirect
          startCountdown();
        } else {
          setError(response.message || 'Verification failed');
          setVerificationStatus('error');
        }
      } catch (err: any) {
        const errorMessage = err.message || 'Verification failed';
        setError(errorMessage);

        // Determine error type from message
        if (errorMessage.toLowerCase().includes('expired')) {
          setVerificationStatus('expired');
        } else if (errorMessage.toLowerCase().includes('already verified')) {
          setVerificationStatus('already-verified');
        } else if (errorMessage.toLowerCase().includes('invalid')) {
          setVerificationStatus('invalid');
        } else {
          setVerificationStatus('error');
        }

        console.error('Email verification error:', err);
      } finally {
        setIsVerifying(false);
      }
    };

    verifyEmail();
  }, [token, checkAuth]);

  const startCountdown = () => {
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          router.push('/');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleResendVerification = async () => {
    try {
      setIsResending(true);
      setResendMessage(null);

      const response = await apiClient.post('/auth/resend-verification', {});

      if (response.success) {
        setResendMessage('Verification email sent! Please check your inbox.');
      } else {
        setResendMessage(response.message || 'Failed to resend verification email');
      }
    } catch (err: any) {
      setResendMessage(err.message || 'Failed to resend verification email');
    } finally {
      setIsResending(false);
    }
  };

  // Verifying state
  if (isVerifying) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="mx-auto h-12 w-12 text-blue-600 animate-spin mb-4" />
          <p className="text-gray-600 text-lg">Verifying your email...</p>
          <p className="text-gray-500 text-sm mt-2">Please wait a moment</p>
        </div>
      </div>
    );
  }

  // Success state
  if (verificationStatus === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">
        <div className="max-w-md w-full bg-white shadow-md rounded-lg p-8 text-center">
          <CheckCircle className="mx-auto h-16 w-16 text-green-500 mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Email Verified Successfully!</h2>
          <p className="text-gray-600 mb-6">
            Your email address has been verified. You now have full access to all Autobacs features.
          </p>
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
            <p className="text-sm text-green-800 font-medium mb-2">
              ✨ What's unlocked:
            </p>
            <ul className="text-sm text-green-700 space-y-1 text-left">
              <li>• Full access to your account</li>
              <li>• Order tracking and history</li>
              <li>• Wishlist and saved items</li>
              <li>• Exclusive deals and offers</li>
            </ul>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-6">
            <p className="text-sm text-blue-800">
              Redirecting to home page in <strong>{countdown}</strong> seconds...
            </p>
          </div>
          <Link
            href="/"
            className="inline-block w-full px-4 py-3 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 transition-colors"
          >
            Continue to Home
          </Link>
        </div>
      </div>
    );
  }

  // Already verified state
  if (verificationStatus === 'already-verified') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">
        <div className="max-w-md w-full bg-white shadow-md rounded-lg p-8 text-center">
          <Info className="mx-auto h-16 w-16 text-blue-500 mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Email Already Verified</h2>
          <p className="text-gray-600 mb-6">
            Your email address has already been verified. You're all set!
          </p>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <p className="text-sm text-blue-800">
              You have full access to your account and all Autobacs features.
            </p>
          </div>
          <Link
            href="/login"
            className="inline-block w-full px-4 py-3 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 transition-colors mb-3"
          >
            Go to Login
          </Link>
          <Link
            href="/"
            className="inline-block text-sm text-blue-600 hover:text-blue-700"
          >
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  // Expired token state
  if (verificationStatus === 'expired') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">
        <div className="max-w-md w-full bg-white shadow-md rounded-lg p-8 text-center">
          <AlertCircle className="mx-auto h-16 w-16 text-yellow-500 mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Verification Link Expired</h2>
          <p className="text-gray-600 mb-6">
            {error || 'This verification link has expired. Verification links are valid for 24 hours.'}
          </p>
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
            <p className="text-sm text-yellow-800">
              Don't worry! You can request a new verification email below.
            </p>
          </div>
          
          {resendMessage && (
            <div className={`mb-4 p-3 rounded-lg ${
              resendMessage.toLowerCase().includes('sent') 
                ? 'bg-green-50 border border-green-200 text-green-800' 
                : 'bg-red-50 border border-red-200 text-red-800'
            }`}>
              <p className="text-sm">{resendMessage}</p>
            </div>
          )}
          
          <button
            onClick={handleResendVerification}
            disabled={isResending}
            className="w-full px-4 py-3 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed mb-3"
          >
            {isResending ? (
              <>
                <Loader2 className="inline-block mr-2 h-4 w-4 animate-spin" />
                Sending...
              </>
            ) : (
              'Resend Verification Email'
            )}
          </button>
          <Link
            href="/login"
            className="inline-block text-sm text-blue-600 hover:text-blue-700"
          >
            Back to Login
          </Link>
        </div>
      </div>
    );
  }

  // Invalid token or error state
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">
      <div className="max-w-md w-full bg-white shadow-md rounded-lg p-8 text-center">
        <XCircle className="mx-auto h-16 w-16 text-red-500 mb-4" />
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Verification Failed</h2>
        <p className="text-gray-600 mb-6">
          {error || 'The verification link is invalid or has already been used.'}
        </p>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <p className="text-sm text-red-800">
            <strong>Possible reasons:</strong>
          </p>
          <ul className="text-sm text-red-700 mt-2 space-y-1 text-left">
            <li>• The link is invalid or malformed</li>
            <li>• The link has already been used</li>
            <li>• The verification token has expired</li>
          </ul>
        </div>
        
        {resendMessage && (
          <div className={`mb-4 p-3 rounded-lg ${
            resendMessage.toLowerCase().includes('sent') 
              ? 'bg-green-50 border border-green-200 text-green-800' 
              : 'bg-red-50 border border-red-200 text-red-800'
          }`}>
            <p className="text-sm">{resendMessage}</p>
          </div>
        )}
        
        <button
          onClick={handleResendVerification}
          disabled={isResending}
          className="w-full px-4 py-3 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed mb-3"
        >
          {isResending ? (
            <>
              <Loader2 className="inline-block mr-2 h-4 w-4 animate-spin" />
              Sending...
            </>
          ) : (
            'Request New Verification Email'
          )}
        </button>
        <Link
          href="/"
          className="inline-block text-sm text-blue-600 hover:text-blue-700"
        >
          Back to Home
        </Link>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-12 w-12 text-blue-600 animate-spin" />
      </div>
    }>
      <VerifyEmailContent />
    </Suspense>
  );
}
