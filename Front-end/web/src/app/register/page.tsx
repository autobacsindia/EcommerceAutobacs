'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useRateLimitTimer } from '@/lib/hooks/useRateLimitTimer';
import { navigateTo } from '@/lib/utils/navigation';
import BrandLogo from '@/components/layout/BrandLogo';
import { Loader2, AlertCircle, CheckCircle } from 'lucide-react';
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
  const [registered, setRegistered] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [rateLimitResetTime, setRateLimitResetTime] = useState<number | null>(null);
  const timeUntilRetry = useRateLimitTimer(rateLimitResetTime);

  const validateForm = () => {
    const errors: Record<string, string> = {};
    if (!formData.name) errors.name = 'Enter your name';
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
      setValidationErrors(prev => { const n = { ...prev }; delete n[name]; return n; });
    }
    if (error) clearError();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;
    try {
      setIsLoading(true);
      await register(formData.name, formData.email, formData.password);
      setRegistered(true);
      setTimeout(() => router.push('/'), 2000);
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
    navigateTo(`/api/v1/auth/${provider}`);
  };

  const inputClass = (field: string) =>
    `w-full px-3 py-2 bg-[#161616] text-white border rounded-sm focus:outline-none focus:ring-2 focus:ring-[#3B9EE8]/50 focus:border-[#3B9EE8] transition-colors font-body placeholder:text-[#555555] ${
      validationErrors[field] ? 'border-red-500' : 'border-[#252525]'
    }`;

  return (
    <div className="min-h-screen bg-[#080808] flex flex-col items-center">
      {/* Logo */}
      <div className="py-8">
        <BrandLogo className="mx-auto" />
      </div>

      {/* Register Card */}
      <div className="w-full max-w-87.5 sm:max-w-100">
        <div className="bg-[#0E0E0E] border border-[#252525] rounded-lg p-6 sm:p-8">
          <h1 className="text-3xl font-condensed font-bold text-white uppercase tracking-wide mb-6">Create Account</h1>

          {registered && (
            <div className="mb-4 p-3 bg-green-500/10 border border-green-500/40 rounded-sm flex items-start gap-2">
              <CheckCircle className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
              <p className="text-sm text-green-400 font-body">Account created! Check your email to verify your account.</p>
            </div>
          )}

          {(error || (timeUntilRetry !== null && timeUntilRetry > 0)) && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/40 rounded-sm flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div className="text-sm text-red-400 font-body">
                {timeUntilRetry !== null && timeUntilRetry > 0
                  ? `Too many attempts. Please try again in ${Math.ceil(timeUntilRetry)}s`
                  : error}
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-condensed font-bold text-[#C4C4C4] uppercase tracking-widest mb-1">
                Your name
              </label>
              <input
                id="name"
                name="name"
                type="text"
                placeholder="First and last name"
                value={formData.name}
                onChange={handleChange}
                className={inputClass('name')}
              />
              {validationErrors.name && (
                <p className="mt-1 text-xs text-red-400 font-body flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {validationErrors.name}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-condensed font-bold text-[#C4C4C4] uppercase tracking-widest mb-1">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                value={formData.email}
                onChange={handleChange}
                className={inputClass('email')}
              />
              {validationErrors.email && (
                <p className="mt-1 text-xs text-red-400 font-body flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {validationErrors.email}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-condensed font-bold text-[#C4C4C4] uppercase tracking-widest mb-1">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                placeholder="At least 6 characters"
                value={formData.password}
                onChange={handleChange}
                className={inputClass('password')}
              />
              {validationErrors.password ? (
                <p className="mt-1 text-xs text-red-400 font-body flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {validationErrors.password}
                </p>
              ) : (
                <p className="mt-1 text-xs text-[#555555] font-body">Passwords must be at least 6 characters.</p>
              )}
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-condensed font-bold text-[#C4C4C4] uppercase tracking-widest mb-1">
                Re-enter password
              </label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                value={formData.confirmPassword}
                onChange={handleChange}
                className={inputClass('confirmPassword')}
              />
              {validationErrors.confirmPassword && (
                <p className="mt-1 text-xs text-red-400 font-body flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {validationErrors.confirmPassword}
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
            By creating an account, you agree to AutoBacs India&apos;s{' '}
            <Link href="/terms" className="text-[#3B9EE8] hover:text-white transition-colors">
              Conditions of Use
            </Link>{' '}
            and{' '}
            <Link href="/privacy" className="text-[#3B9EE8] hover:text-white transition-colors">
              Privacy Notice
            </Link>
            .
          </div>

          {/* Social login */}
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

          {/* Already have an account */}
          <div className="mt-8">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-[#252525]" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-[#0E0E0E] text-[#555555] font-body">Already have an account?</span>
              </div>
            </div>
            <div className="mt-4">
              <Link
                href="/login"
                className="block w-full bg-[#161616] hover:bg-[#252525] border border-[#252525] hover:border-[#3B9EE8] text-white font-condensed font-bold uppercase tracking-widest text-sm py-2.5 px-4 rounded-sm transition-all text-center"
              >
                Sign In
              </Link>
            </div>
          </div>
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
