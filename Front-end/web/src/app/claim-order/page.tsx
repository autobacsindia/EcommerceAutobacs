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

  // Auto-fill from URL params or localStorage
  useEffect(() => {
    const urlToken = searchParams.get('token');
    const urlOrderId = searchParams.get('orderId');
    
    if (urlToken) {
      setToken(urlToken);
      setStep('verify');
    }
    
    if (urlOrderId) {
      setOrderId(urlOrderId);
    }
    
    // Check localStorage for pending claim
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
        toast.success('✨ Magic link sent! Check your email/SMS.');
        setStep('verify');
        
        // In dev mode, show token in console
        if (apiResponse.debugToken) {
          console.log('🔑 DEBUG TOKEN (development only):', apiResponse.debugToken);
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
        password: password || undefined, // Optional password
      });

      if (apiResponse.success) {
        // Store access token
        localStorage.setItem('auth_token', apiResponse.accessToken);
        
        // Clear pending claim
        localStorage.removeItem('pendingClaim');
        
        setClaimed(true);
        toast.success('🎉 Account claimed successfully!');
        
        // Redirect to order page after 2 seconds
        setTimeout(() => {
          router.push(`/orders/${orderId || 'history'}`);
        }, 2000);
      }
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Invalid or expired link');
    } finally {
      setLoading(false);
    }
  };

  if (claimed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 to-blue-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8 text-center">
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="flex justify-center mb-6">
              <CheckCircle className="h-20 w-20 text-green-500 animate-bounce" />
            </div>
            <h2 className="text-3xl font-extrabold text-gray-900 mb-4">
              Account Claimed! 🎉
            </h2>
            <p className="text-gray-600 mb-6">
              You're now logged in. Redirecting to your orders...
            </p>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="bg-green-500 h-2 rounded-full animate-pulse" style={{ width: '100%' }}></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 to-blue-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <h2 className="mt-6 text-4xl font-extrabold text-gray-900">
            {step === 'request' ? 'Claim Your Order' : 'Verify Magic Link'}
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            {step === 'request' 
              ? 'Access your order without creating an account' 
              : 'Enter the token from your email/SMS'}
          </p>
        </div>

        {step === 'request' ? (
          <form onSubmit={handleRequestMagicLink} className="mt-8 space-y-6 bg-white rounded-lg shadow-xl p-8">
            <div className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
                  <input
                    id="email"
                    name="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="appearance-none rounded-lg relative block w-full pl-10 pr-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    placeholder="your@email.com"
                  />
                </div>
              </div>
              
              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">
                  Phone Number
                </label>
                <div className="relative">
                  <Phone className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
                  <input
                    id="phone"
                    name="phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="appearance-none rounded-lg relative block w-full pl-10 pr-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    placeholder="+91 98765 43210"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="orderId" className="block text-sm font-medium text-gray-700 mb-1">
                  Order ID (Optional)
                </label>
                <input
                  id="orderId"
                  name="orderId"
                  type="text"
                  value={orderId}
                  onChange={(e) => setOrderId(e.target.value)}
                  className="appearance-none rounded-lg relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  placeholder="Enter your order ID if available"
                />
              </div>
            </div>

            <div className="bg-purple-50 -mx-8 px-8 py-4 border-t border-b border-purple-100">
              <p className="text-sm text-purple-800 text-center">
                ✨ We'll send a magic link to your email/SMS to verify your identity
              </p>
            </div>

            <button
              type="submit"
              disabled={loading || (!email && !phone)}
              className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Sending...
                </span>
              ) : (
                '📧 Send Magic Link'
              )}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyMagicLink} className="mt-8 space-y-6 bg-white rounded-lg shadow-xl p-8">
            <div className="space-y-4">
              <div>
                <label htmlFor="token" className="block text-sm font-medium text-gray-700 mb-1">
                  Magic Link Token
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
                  <input
                    id="token"
                    name="token"
                    type="text"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    className="appearance-none rounded-lg relative block w-full pl-10 pr-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent font-mono"
                    placeholder="Enter token from email/SMS"
                    required
                  />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                  Set Password (Optional)
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="appearance-none rounded-lg relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  placeholder="Choose a password (optional)"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Leave blank for passwordless login via magic link
                </p>
              </div>
            </div>

            <div className="bg-green-50 -mx-8 px-8 py-4 border-t border-b border-green-100">
              <p className="text-sm text-green-800 text-center">
                ✅ After verification, you'll be automatically logged in
              </p>
            </div>

            <button
              type="submit"
              disabled={loading || !token}
              className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Verifying...
                </span>
              ) : (
                '🔓 Verify & Claim Account'
              )}
            </button>

            <button
              type="button"
              onClick={() => setStep('request')}
              className="w-full text-sm text-purple-600 hover:text-purple-500 font-medium"
            >
              ← Request New Magic Link
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
