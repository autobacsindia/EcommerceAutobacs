'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import apiClient from '@/lib/api';
import toast from 'react-hot-toast';
import { Mail, Phone, Lock, CheckCircle } from 'lucide-react';

export default function ClaimOrderPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuth();

  const [step, setStep] = useState<'request' | 'verify'>('request');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [orderId, setOrderId] = useState('');
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [claimed, setClaimed] = useState(false);

  useEffect(() => {
    const urlToken = searchParams.get('token');
    const urlOrderId = searchParams.get('orderId');

    if (urlToken) { setToken(urlToken); setStep('verify'); }
    if (urlOrderId) setOrderId(urlOrderId);

    const pendingClaim = localStorage.getItem('pendingClaim');
    if (pendingClaim) {
      try {
        const claimData = JSON.parse(pendingClaim);
        if (claimData.email) setEmail(claimData.email);
        if (claimData.phone) setPhone(claimData.phone);
        if (claimData.orderId && !urlOrderId) setOrderId(claimData.orderId);
      } catch (e) {
        console.error('Failed to parse pending claim:', e);
      }
    }
  }, [searchParams]);

  const handleRequestMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const apiResponse: any = await apiClient.post('/auth/magic-link/request', {
        email: email || undefined,
        phone: phone || undefined,
        orderId: orderId || undefined,
      });
      if (apiResponse.success) {
        toast.success('Magic link sent! Check your email/SMS.');
        setStep('verify');
        if (apiResponse.debugToken) {
          console.log('DEBUG TOKEN (development only):', apiResponse.debugToken);
          toast('Debug token logged to console', { duration: 5000 });
        }
      }
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to send magic link');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const apiResponse: any = await apiClient.post('/auth/magic-link/verify', {
        token,
        password: password || undefined,
      });
      if (apiResponse.success) {
        localStorage.setItem('auth_token', apiResponse.accessToken);
        localStorage.removeItem('pendingClaim');
        setClaimed(true);
        toast.success('Account claimed successfully!');
        setTimeout(() => { router.push(`/orders/${orderId || 'history'}`); }, 2000);
      }
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Invalid or expired link');
    } finally {
      setLoading(false);
    }
  };

  const inputClass = 'w-full bg-[#161616] border border-[#252525] text-white placeholder:text-[#555555] rounded-sm px-4 py-2.5 focus:outline-none focus:border-[#3B9EE8] font-body text-sm transition-colors';
  const inputWithIconClass = inputClass + ' pl-10';

  if (claimed) {
    return (
      <div className="min-h-screen bg-[#080808] flex items-center justify-center py-12 px-4">
        <div className="max-w-md w-full text-center">
          <div className="bg-[#0E0E0E] border border-[#252525] rounded-sm p-10">
            <CheckCircle className="h-20 w-20 text-green-400 mx-auto mb-6 animate-bounce" />
            <h2 className="text-3xl font-condensed font-bold text-white uppercase tracking-wide mb-4">Account Claimed!</h2>
            <p className="text-[#C4C4C4] font-body mb-8">You&apos;re now logged in. Redirecting to your orders...</p>
            <div className="w-full bg-[#252525] rounded-full h-1.5">
              <div className="bg-[#3B9EE8] h-1.5 rounded-full animate-pulse" style={{ width: '100%' }} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#080808] flex items-center justify-center py-12 px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <p className="text-[#3B9EE8] font-condensed font-bold text-sm uppercase tracking-widest mb-2">Account Access</p>
          <h2 className="text-4xl font-condensed font-bold text-white uppercase tracking-wide">
            {step === 'request' ? 'Claim Your Order' : 'Verify Magic Link'}
          </h2>
          <p className="mt-2 text-[#C4C4C4] font-body text-sm">
            {step === 'request'
              ? 'Access your order without creating an account'
              : 'Enter the token from your email/SMS'}
          </p>
        </div>

        {step === 'request' ? (
          <form onSubmit={handleRequestMagicLink} className="bg-[#0E0E0E] border border-[#252525] rounded-sm p-6 space-y-4">
            <div>
              <label htmlFor="email" className="block text-xs font-condensed font-bold text-[#555555] uppercase tracking-widest mb-1">
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#555555]" />
                <input
                  id="email"
                  name="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputWithIconClass}
                  placeholder="your@email.com"
                />
              </div>
            </div>

            <div>
              <label htmlFor="phone" className="block text-xs font-condensed font-bold text-[#555555] uppercase tracking-widest mb-1">
                Phone Number
              </label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#555555]" />
                <input
                  id="phone"
                  name="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className={inputWithIconClass}
                  placeholder="+91 98765 43210"
                />
              </div>
            </div>

            <div>
              <label htmlFor="orderId" className="block text-xs font-condensed font-bold text-[#555555] uppercase tracking-widest mb-1">
                Order ID <span className="normal-case font-body tracking-normal">(optional)</span>
              </label>
              <input
                id="orderId"
                name="orderId"
                type="text"
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
                className={inputClass}
                placeholder="Enter your order ID if available"
              />
            </div>

            <div className="bg-[#3B9EE8]/10 border border-[#3B9EE8]/30 rounded-sm px-4 py-3">
              <p className="text-[#3B9EE8] font-body text-sm text-center">
                We&apos;ll send a magic link to your email/SMS to verify your identity.
              </p>
            </div>

            <button
              type="submit"
              disabled={loading || (!email && !phone)}
              className="w-full bg-[#3B9EE8] hover:bg-[#1A6FB5] text-white font-condensed font-bold uppercase tracking-widest py-3 rounded-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? (
                <><span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> Sending...</>
              ) : (
                'Send Magic Link'
              )}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyMagicLink} className="bg-[#0E0E0E] border border-[#252525] rounded-sm p-6 space-y-4">
            <div>
              <label htmlFor="token" className="block text-xs font-condensed font-bold text-[#555555] uppercase tracking-widest mb-1">
                Magic Link Token
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#555555]" />
                <input
                  id="token"
                  name="token"
                  type="text"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className={inputWithIconClass + ' font-mono'}
                  placeholder="Enter token from email/SMS"
                  required
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-xs font-condensed font-bold text-[#555555] uppercase tracking-widest mb-1">
                Set Password <span className="normal-case font-body tracking-normal">(optional)</span>
              </label>
              <input
                id="password"
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
                placeholder="Choose a password (optional)"
              />
              <p className="text-[#555555] font-body text-xs mt-1">Leave blank for passwordless login via magic link</p>
            </div>

            <div className="bg-green-500/10 border border-green-500/30 rounded-sm px-4 py-3">
              <p className="text-green-300 font-body text-sm text-center">
                After verification, you&apos;ll be automatically logged in.
              </p>
            </div>

            <button
              type="submit"
              disabled={loading || !token}
              className="w-full bg-[#3B9EE8] hover:bg-[#1A6FB5] text-white font-condensed font-bold uppercase tracking-widest py-3 rounded-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? (
                <><span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> Verifying...</>
              ) : (
                'Verify & Claim Account'
              )}
            </button>

            <button
              type="button"
              onClick={() => setStep('request')}
              className="w-full text-sm font-condensed font-bold text-[#3B9EE8] hover:text-white uppercase tracking-widest transition-colors py-2"
            >
              ← Request New Magic Link
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
