'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useRateLimitTimer } from '@/lib/hooks/useRateLimitTimer';
import { navigateTo } from '@/lib/utils/navigation';
import BrandLogo from '@/components/layout/BrandLogo';
import { Loader2, AlertCircle } from 'lucide-react';
import { FcGoogle } from 'react-icons/fc';
import { FaFacebook } from 'react-icons/fa';

export default function LoginPage() {
  const router = useRouter();
  const { login, error, clearError } = useAuth();
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [rateLimitResetTime, setRateLimitResetTime] = useState<number | null>(null);
  const timeUntilRetry = useRateLimitTimer(rateLimitResetTime);

  const validateForm = () => {
    const errors: Record<string, string> = {};

    if (!formData.email) {
      errors.email = 'Enter your email';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      errors.email = 'Enter a valid email address';
    }

    if (!formData.password) {
      errors.password = 'Enter your password';
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    
    if (validationErrors[name]) {
      setValidationErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[name];
        return newErrors;
      });
    }
    
    if (error) {
      clearError();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    try {
      setIsLoading(true);
      await login(formData.email, formData.password);
      router.push('/');
    } catch (err: any) {
      if (err.status === 429 && err.rateLimitInfo?.resetTime) {
        setRateLimitResetTime(err.rateLimitInfo.resetTime);
      }
      console.error('Login failed:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSocialLogin = (provider: 'google' | 'facebook') => {
    const url = `/api/v1/auth/${provider}`;
    navigateTo(url);
  };

  return (
    <div className="min-h-screen bg-white flex flex-col items-center">
      {/* Logo Section */}
      <div className="py-8">
        <BrandLogo className="mx-auto" theme="light" />
      </div>

      {/* Login Card */}
      <div className="w-full max-w-[350px] sm:max-w-[400px]">
        <div className="border border-gray-300 rounded-lg p-6 sm:p-8">
          <h1 className="text-3xl font-normal mb-6 text-gray-900">Sign in</h1>

          {(error || (timeUntilRetry !== null && timeUntilRetry > 0)) && (
            <div className="mb-4 p-3 bg-red-50 border border-red-400 rounded-md flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-red-700">
                {timeUntilRetry !== null && timeUntilRetry > 0 
                  ? `Too many attempts. Please try again in ${Math.ceil(timeUntilRetry / 1000)} seconds.`
                  : error}
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label htmlFor="email" className="block text-sm font-bold text-gray-700 mb-1">
                Email or mobile phone number
              </label>
              <input
                id="email"
                type="text"
                name="email"
                value={formData.email}
                onChange={handleChange}
                className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-yellow-500/50 focus:border-yellow-600 transition-colors
                  ${validationErrors.email ? 'border-red-600' : 'border-gray-400'}`}
              />
              {validationErrors.email && (
                <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {validationErrors.email}
                </p>
              )}
            </div>

            <div className="mb-6">
              <div className="flex justify-between items-center mb-1">
                <label htmlFor="password" className="block text-sm font-bold text-gray-700">
                  Password
                </label>
                <Link
                  href="/forgot-password"
                  className="text-xs text-blue-700 hover:text-red-700 hover:underline"
                >
                  Forgot Password
                </Link>
              </div>
              <input
                id="password"
                type="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-yellow-500/50 focus:border-yellow-600 transition-colors
                  ${validationErrors.password ? 'border-red-600' : 'border-gray-400'}`}
              />
              {validationErrors.password && (
                <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {validationErrors.password}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading || (timeUntilRetry !== null && timeUntilRetry > 0)}
              className="w-full bg-[#FFD814] hover:bg-[#F7CA00] text-black text-sm font-normal py-2 px-4 rounded border border-[#FCD200] shadow-sm active:border-[#F0B800] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Continue'}
            </button>
          </form>

          <div className="mt-6 text-xs text-gray-600">
            By continuing, you agree to AutoBacs India's{' '}
            <Link href="/terms" className="text-blue-700 hover:text-red-700 hover:underline">
              Conditions of Use
            </Link>{' '}
            and{' '}
            <Link href="/privacy" className="text-blue-700 hover:text-red-700 hover:underline">
              Privacy Notice
            </Link>
            .
          </div>

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">Or continue with</span>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => handleSocialLogin('google')}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-gray-300 rounded shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
              >
                <FcGoogle className="w-5 h-5" />
                <span>Google</span>
              </button>
              <button
                type="button"
                onClick={() => handleSocialLogin('facebook')}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-gray-300 rounded shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
              >
                <FaFacebook className="w-5 h-5 text-blue-600" />
                <span>Facebook</span>
              </button>
            </div>
          </div>
        </div>

        {/* New to AutoBacs section */}
        <div className="my-6 text-center">
          <div className="relative mb-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="px-2 bg-white text-gray-500">New to AutoBacs?</span>
            </div>
          </div>
          <Link
            href="/register"
            className="block w-full bg-white hover:bg-gray-50 text-gray-900 text-sm py-2 px-4 rounded border border-gray-300 shadow-sm transition-colors text-center"
          >
            Create your AutoBacs account
          </Link>
        </div>
      </div>

      {/* Footer */}
      <div className="w-full border-t border-gray-200 mt-auto bg-white/50">
        <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col items-center justify-center space-y-4">
            <div className="flex space-x-8 text-xs text-blue-700">
              <Link href="/conditions" className="hover:text-red-700 hover:underline">Conditions of Use</Link>
              <Link href="/privacy" className="hover:text-red-700 hover:underline">Privacy Notice</Link>
              <Link href="/help" className="hover:text-red-700 hover:underline">Help</Link>
            </div>
            <p className="text-xs text-gray-500">
              Copyright © 2025 AutoBacs India . All rights reserved
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
