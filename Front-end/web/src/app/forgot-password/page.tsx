'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Mail, Loader2, ArrowLeft, CheckCircle } from 'lucide-react';
import { apiClient } from '@/lib/api';
import { useRateLimitTimer } from '@/lib/hooks/useRateLimitTimer';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [rateLimitResetTime, setRateLimitResetTime] = useState<number | null>(null);
  const timeUntilRetry = useRateLimitTimer(rateLimitResetTime);

  const validateEmail = () => {
    if (!email) {
      setValidationError('Email address is required');
      return false;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setValidationError('Please enter a valid email address');
      return false;
    }

    setValidationError(null);
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateEmail()) {
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const response = await apiClient.post('/auth/forgot-password', { email });

      if (response.success) {
        setIsSuccess(true);
      } else {
        setError(response.message || 'Failed to send reset email. Please try again.');
      }
    } catch (err: any) {
      if (err.status === 429 && err.rateLimitInfo?.resetTime) {
        setRateLimitResetTime(err.rateLimitInfo.resetTime);
        setError(err.message || 'Too many requests. Please try again later.');
      } else {
        setError(err.message || 'An error occurred. Please try again later.');
      }
      console.error('Forgot password error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value);
    setValidationError(null);
    setError(null);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        {/* Header */}
        <div className="text-center">
          <Mail className="mx-auto h-12 w-12 text-blue-600" />
          <h2 className="mt-6 text-3xl font-bold text-gray-900">
            {isSuccess ? 'Check Your Email' : 'Forgot Your Password?'}
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            {isSuccess ? (
              "We've sent password reset instructions to your email"
            ) : (
              <>
                No worries! Enter your email and we'll send you reset instructions.{' '}
                <Link href="/login" className="font-medium text-blue-600 hover:text-blue-500">
                  Back to login
                </Link>
              </>
            )}
          </p>
        </div>

        {isSuccess ? (
          /* Success State */
          <div className="bg-white shadow-md rounded-lg p-8">
            <div className="text-center">
              <CheckCircle className="mx-auto h-16 w-16 text-green-500 mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Email Sent Successfully
              </h3>
              <p className="text-gray-600 mb-6">
                If an account exists for <strong>{email}</strong>, you will receive password reset 
                instructions within a few minutes.
              </p>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                <p className="text-sm text-blue-800">
                  <strong>Didn't receive the email?</strong>
                </p>
                <ul className="text-sm text-blue-700 mt-2 space-y-1 text-left">
                  <li>• Check your spam or junk folder</li>
                  <li>• Make sure you entered the correct email</li>
                  <li>• Wait a few minutes for the email to arrive</li>
                  <li>• The reset link expires in 1 hour</li>
                </ul>
              </div>
              <div className="flex flex-col gap-3">
                <Link
                  href="/login"
                  className="inline-flex items-center justify-center px-4 py-2 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 transition-colors"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to Login
                </Link>
                <button
                  onClick={() => {
                    setIsSuccess(false);
                    setEmail('');
                  }}
                  className="text-sm text-gray-600 hover:text-gray-700"
                >
                  Try a different email
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* Form State */
          <form className="bg-white shadow-md rounded-lg p-8 space-y-6" onSubmit={handleSubmit}>
            {/* Error Message */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-md p-4">
                <p className="text-sm text-red-800">{error}</p>
                {timeUntilRetry !== null && timeUntilRetry > 0 && (
                  <p className="text-sm text-red-700 mt-1">
                    Please wait {Math.floor(timeUntilRetry / 60)}:{(timeUntilRetry % 60).toString().padStart(2, '0')} before trying again.
                  </p>
                )}
              </div>
            )}

            {/* Email Field */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                Email Address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={handleInputChange}
                className={`block w-full px-4 py-3 border ${
                  validationError || error ? 'border-red-300' : 'border-gray-300'
                } rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-base`}
                placeholder="you@example.com"
                disabled={isLoading}
                autoFocus
              />
              {validationError && (
                <p className="mt-1 text-sm text-red-600">{validationError}</p>
              )}
            </div>

            {/* Submit Button */}
            <div>
              <button
                type="submit"
                disabled={isLoading || (timeUntilRetry !== null && timeUntilRetry > 0)}
                className="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="animate-spin -ml-1 mr-2 h-5 w-5" />
                    Sending Reset Link...
                  </>
                ) : timeUntilRetry !== null && timeUntilRetry > 0 ? (
                  `Please wait ${Math.floor(timeUntilRetry / 60)}:${(timeUntilRetry % 60).toString().padStart(2, '0')}`
                ) : (
                  'Send Reset Link'
                )}
              </button>
            </div>

            {/* Help Text */}
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-sm text-gray-600">
                <strong>Security Notice:</strong> For your protection, we won't reveal whether an 
                account exists for this email address.
              </p>
            </div>

            {/* Back to Login Link */}
            <div className="text-center">
              <Link
                href="/login"
                className="inline-flex items-center text-sm font-medium text-blue-600 hover:text-blue-500"
              >
                <ArrowLeft className="mr-1 h-4 w-4" />
                Back to Login
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Mail, Loader2, ArrowLeft, CheckCircle } from 'lucide-react';
import { apiClient } from '@/lib/api';
import { useRateLimitTimer } from '@/lib/hooks/useRateLimitTimer';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [rateLimitResetTime, setRateLimitResetTime] = useState<number | null>(null);
  const timeUntilRetry = useRateLimitTimer(rateLimitResetTime);

  const validateEmail = () => {
    if (!email) {
      setValidationError('Email address is required');
      return false;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setValidationError('Please enter a valid email address');
      return false;
    }

    setValidationError(null);
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateEmail()) {
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const response = await apiClient.post('/auth/forgot-password', { email });

      if (response.success) {
        setIsSuccess(true);
      } else {
        setError(response.message || 'Failed to send reset email. Please try again.');
      }
    } catch (err: any) {
      if (err.status === 429 && err.rateLimitInfo?.resetTime) {
        setRateLimitResetTime(err.rateLimitInfo.resetTime);
        setError(err.message || 'Too many requests. Please try again later.');
      } else {
        setError(err.message || 'An error occurred. Please try again later.');
      }
      console.error('Forgot password error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value);
    setValidationError(null);
    setError(null);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        {/* Header */}
        <div className="text-center">
          <Mail className="mx-auto h-12 w-12 text-blue-600" />
          <h2 className="mt-6 text-3xl font-bold text-gray-900">
            {isSuccess ? 'Check Your Email' : 'Forgot Your Password?'}
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            {isSuccess ? (
              "We've sent password reset instructions to your email"
            ) : (
              <>
                No worries! Enter your email and we'll send you reset instructions.{' '}
                <Link href="/login" className="font-medium text-blue-600 hover:text-blue-500">
                  Back to login
                </Link>
              </>
            )}
          </p>
        </div>

        {isSuccess ? (
          /* Success State */
          <div className="bg-white shadow-md rounded-lg p-8">
            <div className="text-center">
              <CheckCircle className="mx-auto h-16 w-16 text-green-500 mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Email Sent Successfully
              </h3>
              <p className="text-gray-600 mb-6">
                If an account exists for <strong>{email}</strong>, you will receive password reset 
                instructions within a few minutes.
              </p>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                <p className="text-sm text-blue-800">
                  <strong>Didn't receive the email?</strong>
                </p>
                <ul className="text-sm text-blue-700 mt-2 space-y-1 text-left">
                  <li>• Check your spam or junk folder</li>
                  <li>• Make sure you entered the correct email</li>
                  <li>• Wait a few minutes for the email to arrive</li>
                  <li>• The reset link expires in 1 hour</li>
                </ul>
              </div>
              <div className="flex flex-col gap-3">
                <Link
                  href="/login"
                  className="inline-flex items-center justify-center px-4 py-2 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 transition-colors"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to Login
                </Link>
                <button
                  onClick={() => {
                    setIsSuccess(false);
                    setEmail('');
                  }}
                  className="text-sm text-gray-600 hover:text-gray-700"
                >
                  Try a different email
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* Form State */
          <form className="bg-white shadow-md rounded-lg p-8 space-y-6" onSubmit={handleSubmit}>
            {/* Error Message */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-md p-4">
                <p className="text-sm text-red-800">{error}</p>
                {timeUntilRetry !== null && timeUntilRetry > 0 && (
                  <p className="text-sm text-red-700 mt-1">
                    Please wait {Math.floor(timeUntilRetry / 60)}:{(timeUntilRetry % 60).toString().padStart(2, '0')} before trying again.
                  </p>
                )}
              </div>
            )}

            {/* Email Field */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                Email Address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={handleInputChange}
                className={`block w-full px-4 py-3 border ${
                  validationError || error ? 'border-red-300' : 'border-gray-300'
                } rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-base`}
                placeholder="you@example.com"
                disabled={isLoading}
                autoFocus
              />
              {validationError && (
                <p className="mt-1 text-sm text-red-600">{validationError}</p>
              )}
            </div>

            {/* Submit Button */}
            <div>
              <button
                type="submit"
                disabled={isLoading || (timeUntilRetry !== null && timeUntilRetry > 0)}
                className="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="animate-spin -ml-1 mr-2 h-5 w-5" />
                    Sending Reset Link...
                  </>
                ) : timeUntilRetry !== null && timeUntilRetry > 0 ? (
                  `Please wait ${Math.floor(timeUntilRetry / 60)}:${(timeUntilRetry % 60).toString().padStart(2, '0')}`
                ) : (
                  'Send Reset Link'
                )}
              </button>
            </div>

            {/* Help Text */}
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-sm text-gray-600">
                <strong>Security Notice:</strong> For your protection, we won't reveal whether an 
                account exists for this email address.
              </p>
            </div>

            {/* Back to Login Link */}
            <div className="text-center">
              <Link
                href="/login"
                className="inline-flex items-center text-sm font-medium text-blue-600 hover:text-blue-500"
              >
                <ArrowLeft className="mr-1 h-4 w-4" />
                Back to Login
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
