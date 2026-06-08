'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useRateLimitTimer } from '@/lib/hooks/useRateLimitTimer';
import { navigateTo } from '@/lib/utils/navigation';
import Image from 'next/image';
import { Loader2, AlertCircle } from 'lucide-react';
import { FcGoogle } from 'react-icons/fc';
import { FaFacebook } from 'react-icons/fa';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, error, clearError } = useAuth();

  const reasonMessages: Record<string, string> = {
    context_mismatch: 'Your admin session was terminated because your network or device changed. Please sign in again.',
    refresh_failed: 'Your session expired. Please sign in again.',
  };
  const reasonBanner = searchParams.get('reason') ? reasonMessages[searchParams.get('reason')!] ?? null : null;
  const [formData, setFormData] = useState({ email: '', password: '' });
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
    if (!formData.password) errors.password = 'Enter your password';
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (validationErrors[name]) {
      setValidationErrors(prev => { const n = { ...prev }; delete n[name]; return n; });
    }
    if (error) clearError();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;
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
    navigateTo(`/api/v1/auth/${provider}`);
  };

  return (
    <div className="min-h-screen bg-[#080808] flex flex-col items-center">
      {/* Logo */}
      <div className="py-8">
        <a href="/" className="block mx-auto">
          <Image
            src="https://res.cloudinary.com/dhwxtl6l8/image/upload/v1775543920/Roavion-Logo_xwqbx9.png"
            alt="Roavion"
            width={596}
            height={199}
            priority
            className="object-contain h-28 w-auto mx-auto"
          />
        </a>
      </div>

      {/* Login Card */}
      <div className="w-full max-w-87.5 sm:max-w-100">
        <div className="bg-[#0E0E0E] border border-[#252525] rounded-lg p-6 sm:p-8">
          <h1 className="text-3xl font-condensed font-bold text-white uppercase tracking-wide mb-6">Sign In</h1>

          {reasonBanner && (
            <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/40 rounded-sm flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
              <div className="text-sm text-yellow-400 font-body">{reasonBanner}</div>
            </div>
          )}

          {(error || (timeUntilRetry !== null && timeUntilRetry > 0)) && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/40 rounded-sm flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div className="text-sm text-red-400 font-body">
                {timeUntilRetry !== null && timeUntilRetry > 0
                  ? `Too many attempts. Please try again in ${Math.ceil(timeUntilRetry / 1000)} seconds.`
                  : error}
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label htmlFor="email" className="block text-sm font-condensed font-bold text-[#C4C4C4] uppercase tracking-widest mb-1">
                Email or mobile phone number
              </label>
              <input
                id="email"
                type="text"
                name="email"
                value={formData.email}
                onChange={handleChange}
                className={`w-full px-3 py-2 bg-[#161616] text-white border rounded-sm focus:outline-none focus:ring-2 focus:ring-[#3B9EE8]/50 focus:border-[#3B9EE8] transition-colors font-body placeholder:text-[#555555]
                  ${validationErrors.email ? 'border-red-500' : 'border-[#252525]'}`}
              />
              {validationErrors.email && (
                <p className="mt-1 text-xs text-red-400 font-body flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {validationErrors.email}
                </p>
              )}
            </div>

            <div className="mb-6">
              <div className="flex justify-between items-center mb-1">
                <label htmlFor="password" className="block text-sm font-condensed font-bold text-[#C4C4C4] uppercase tracking-widest">
                  Password
                </label>
                <Link
                  href="/forgot-password"
                  className="text-xs text-[#3B9EE8] hover:text-white transition-colors"
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
                className={`w-full px-3 py-2 bg-[#161616] text-white border rounded-sm focus:outline-none focus:ring-2 focus:ring-[#3B9EE8]/50 focus:border-[#3B9EE8] transition-colors font-body placeholder:text-[#555555]
                  ${validationErrors.password ? 'border-red-500' : 'border-[#252525]'}`}
              />
              {validationErrors.password && (
                <p className="mt-1 text-xs text-red-400 font-body flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {validationErrors.password}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading || (timeUntilRetry !== null && timeUntilRetry > 0)}
              className="w-full bg-[#3B9EE8] hover:bg-[#1A6FB5] text-white font-condensed font-bold uppercase tracking-widest py-2.5 px-4 rounded-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Continue'}
            </button>
          </form>

          <div className="mt-6 text-xs text-[#555555] font-body">
            By continuing, you agree to AutoBacs India&apos;s{' '}
            <Link href="/terms" className="text-[#3B9EE8] hover:text-white transition-colors">
              Conditions of Use
            </Link>{' '}
            and{' '}
            <Link href="/privacy" className="text-[#3B9EE8] hover:text-white transition-colors">
              Privacy Notice
            </Link>
            .
          </div>

          {/* Divider */}
          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-[#252525]" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-[#0E0E0E] text-[#555555] font-body">Or continue with</span>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => handleSocialLogin('google')}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-[#161616] border border-[#252525] rounded-sm hover:border-[#3B9EE8] text-sm font-condensed font-bold text-[#C4C4C4] hover:text-white transition-all"
              >
                <FcGoogle className="w-5 h-5" />
                <span>Google</span>
              </button>
              <button
                type="button"
                onClick={() => handleSocialLogin('facebook')}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-[#161616] border border-[#252525] rounded-sm hover:border-[#3B9EE8] text-sm font-condensed font-bold text-[#C4C4C4] hover:text-white transition-all"
              >
                <FaFacebook className="w-5 h-5 text-blue-500" />
                <span>Facebook</span>
              </button>
            </div>
          </div>
        </div>

        {/* New to AutoBacs */}
        <div className="my-6 text-center">
          <div className="relative mb-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-[#252525]" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="px-2 bg-[#080808] text-[#555555] font-body">New to AutoBacs?</span>
            </div>
          </div>
          <Link
            href="/register"
            className="block w-full bg-[#0E0E0E] hover:bg-[#161616] border border-[#252525] hover:border-[#3B9EE8] text-white font-condensed font-bold uppercase tracking-widest text-sm py-2.5 px-4 rounded-sm transition-all text-center"
          >
            Create your AutoBacs account
          </Link>
        </div>
      </div>

      {/* Footer */}
      <div className="w-full border-t border-[#252525] mt-auto bg-[#0E0E0E]">
        <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col items-center justify-center space-y-4">
            <div className="flex space-x-8 text-xs text-[#3B9EE8]">
              <Link href="/conditions" className="hover:text-white transition-colors">Conditions of Use</Link>
              <Link href="/privacy" className="hover:text-white transition-colors">Privacy Notice</Link>
              <Link href="/help" className="hover:text-white transition-colors">Help</Link>
            </div>
            <p className="text-xs text-[#555555] font-body">
              Copyright © 2025 AutoBacs India. All rights reserved
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
