'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useRateLimitTimer } from '@/lib/hooks/useRateLimitTimer';
import BrandLogo from '@/components/layout/BrandLogo';
import { Loader2, AlertCircle } from 'lucide-react';
import { FcGoogle } from 'react-icons/fc';
import { FaFacebook } from 'react-icons/fa';

export default function RegisterPage() {
  const router = useRouter();
  const { register, error, clearError } = useAuth();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [rateLimitResetTime, setRateLimitResetTime] = useState<number | null>(null);
  const timeUntilRetry = useRateLimitTimer(rateLimitResetTime);

  const validateForm = () => {
    const errors: Record<string, string> = {};

    if (!formData.name) {
      errors.name = 'Enter your name';
    }

    if (!formData.email) {
      errors.email = 'Enter your email';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      errors.email = 'Enter a valid email address';
    }

    if (!formData.password) {
      errors.password = 'Enter your password';
    } else if (formData.password.length < 6) {
      errors.password = 'Password must be at least 6 characters';
    }

    if (formData.password !== formData.confirmPassword) {
      errors.confirmPassword = 'Passwords do not match';
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
      await register(formData.name, formData.email, formData.password);
      router.push('/');
    } catch (err: any) {
      if (err.status === 429 && err.rateLimitInfo?.resetTime) {
        setRateLimitResetTime(err.rateLimitInfo.resetTime);
      }
      console.error('Registration failed:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSocialLogin = (provider: 'google' | 'facebook') => {
    const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:5000';
    const url = `${apiBaseUrl}/auth/${provider}`;
    window.location.href = url;
  };

  return (
    <div className="min-h-screen bg-white flex flex-col items-center">
      {/* Logo Section */}
      <div className="py-8">
        <BrandLogo className="mx-auto" theme="light" />
      </div>

      {/* Register Card */}
      <div className="w-full max-w-[350px] sm:max-w-[400px]">
        <div className="border border-gray-300 rounded-lg p-6 sm:p-8">
          <h1 className="text-3xl font-normal mb-6 text-gray-900">Create account</h1>

          {(error || (timeUntilRetry !== null && timeUntilRetry > 0)) && (
            <div className="mb-4 p-3 bg-red-50 border border-red-400 rounded-md flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-red-700">
                {timeUntilRetry !== null && timeUntilRetry > 0 
                  ? `Too many attempts. Please try again in ${Math.ceil(timeUntilRetry)}s` 
                  : error}
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-bold text-gray-900 mb-1">
                Your name
              </label>
              <input
                id="name"
                name="name"
                type="text"
                placeholder="First and last name"
                value={formData.name}
                onChange={handleChange}
                className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-yellow-500/50 focus:border-yellow-600 transition-colors
                  ${validationErrors.name ? 'border-red-600' : 'border-gray-400'}`}
              />
              {validationErrors.name && (
                <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {validationErrors.name}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-bold text-gray-900 mb-1">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
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

            <div>
              <label htmlFor="password" className="block text-sm font-bold text-gray-900 mb-1">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                placeholder="At least 6 characters"
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
              {!validationErrors.password && (
                <p className="mt-1 text-xs text-gray-500">
                  Passwords must be at least 6 characters.
                </p>
              )}
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-bold text-gray-900 mb-1">
                Re-enter password
              </label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                value={formData.confirmPassword}
                onChange={handleChange}
                className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-yellow-500/50 focus:border-yellow-600 transition-colors
                  ${validationErrors.confirmPassword ? 'border-red-600' : 'border-gray-400'}`}
              />
              {validationErrors.confirmPassword && (
                <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {validationErrors.confirmPassword}
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
            By creating an account, you agree to AutoBacs India's{' '}
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

          <div className="mt-8">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">Already have an account?</span>
              </div>
            </div>

            <div className="mt-4">
              <Link
                href="/login"
                className="block w-full bg-white hover:bg-gray-50 text-gray-900 text-sm py-2 px-4 rounded border border-gray-300 shadow-sm transition-colors text-center shadow-inner"
              >
                Sign in
              </Link>
            </div>
          </div>
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
