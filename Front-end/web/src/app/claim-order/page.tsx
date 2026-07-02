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
        // auth token is set via httpOnly cookie by the backend — no localStorage write needed
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

  const inputClass = 'w-full bg-obsidian-raised border border-hairline text-ink placeholder:text-ink-muted rounded-sm px-4 py-2.5 focus:outline-none focus:border-gold font-display text-sm transition-colors';
  const inputWithIconClass = inputClass + ' pl-10';

  if (claimed) {
    return (
      <div className="min-h-screen bg-obsidian-deep flex items-center justify-center py-12 px-4">
        <div className="max-w-md w-full text-center">
          <div className="bg-obsidian border border-hairline rounded-sm p-10">
            <CheckCircle className="h-20 w-20 text-green-400 mx-auto mb-6 animate-bounce" />
            <h2 className="text-3xl font-display font-light text-ink tracking-[-0.01em] mb-4">Account Claimed!</h2>
            <p className="text-ink/70 font-display mb-8">You&apos;re now logged in. Redirecting to your orders...</p>
            <div className="w-full bg-obsidian-raised rounded-full h-1.5">
              <div className="bg-gold h-1.5 rounded-full animate-pulse" style={{ width: '100%' }} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-obsidian-deep flex items-center justify-center py-12 px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <p className="font-display text-[10px] uppercase tracking-[0.28em] text-gold mb-2">Account Access</p>
          <h2 className="text-4xl font-display font-light text-ink tracking-[-0.01em]">
            {step === 'request' ? 'Claim Your Order' : 'Verify Magic Link'}
          </h2>
          <p className="mt-2 text-ink/70 font-display text-sm">
            {step === 'request'
              ? 'Access your order without creating an account'
              : 'Enter the token from your email/SMS'}
          </p>
        </div>

        {step === 'request' ? (
          <form onSubmit={handleRequestMagicLink} className="bg-obsidian border border-hairline rounded-sm p-6 space-y-4">
            <div>
              <label htmlFor="email" className="block text-xs font-display font-bold text-ink-muted uppercase tracking-widest mb-1">
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-muted" />
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
              <label htmlFor="phone" className="block text-xs font-display font-bold text-ink-muted uppercase tracking-widest mb-1">
                Phone Number
              </label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-muted" />
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
              <label htmlFor="orderId" className="block text-xs font-display font-bold text-ink-muted uppercase tracking-widest mb-1">
                Order ID <span className="normal-case font-display tracking-normal">(optional)</span>
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

            <div className="bg-gold/10 border border-gold/30 rounded-sm px-4 py-3">
              <p className="text-gold font-display text-sm text-center">
                We&apos;ll send a magic link to your email/SMS to verify your identity.
              </p>
            </div>

            <button
              type="submit"
              disabled={loading || (!email && !phone)}
              className="w-full bg-gold hover:opacity-90 text-obsidian font-display font-bold uppercase tracking-widest py-3 rounded-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? (
                <><span className="animate-spin rounded-full h-4 w-4 border-b-2 border-hairline" /> Sending...</>
              ) : (
                'Send Magic Link'
              )}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyMagicLink} className="bg-obsidian border border-hairline rounded-sm p-6 space-y-4">
            <div>
              <label htmlFor="token" className="block text-xs font-display font-bold text-ink-muted uppercase tracking-widest mb-1">
                Magic Link Token
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-muted" />
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
              <label htmlFor="password" className="block text-xs font-display font-bold text-ink-muted uppercase tracking-widest mb-1">
                Set Password <span className="normal-case font-display tracking-normal">(optional)</span>
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
              <p className="text-ink-muted font-display text-xs mt-1">Leave blank for passwordless login via magic link</p>
            </div>

            <div className="bg-green-500/10 border border-green-500/30 rounded-sm px-4 py-3">
              <p className="text-green-300 font-display text-sm text-center">
                After verification, you&apos;ll be automatically logged in.
              </p>
            </div>

            <button
              type="submit"
              disabled={loading || !token}
              className="w-full bg-gold hover:opacity-90 text-obsidian font-display font-bold uppercase tracking-widest py-3 rounded-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? (
                <><span className="animate-spin rounded-full h-4 w-4 border-b-2 border-hairline" /> Verifying...</>
              ) : (
                'Verify & Claim Account'
              )}
            </button>

            <button
              type="button"
              onClick={() => setStep('request')}
              className="w-full text-sm font-display font-bold text-gold hover:text-ink uppercase tracking-widest transition-colors py-2"
            >
              ← Request New Magic Link
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
