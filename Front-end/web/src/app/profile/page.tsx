'use client';

import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { User, Shield, MapPin, Edit, X, Plus, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import apiClient from '@/lib/api';
import profileService from '@/lib/profileService';
import { profileKeys } from '@/hooks/queries/keys';
import { Address } from '@/lib/types';
import KarmaBadge from '@/components/profile/KarmaBadge';
import RecentOrdersCard from '@/components/profile/RecentOrdersCard';

const inputClass = 'mt-1 block w-full bg-obsidian-raised border border-hairline text-ink placeholder:text-ink-muted rounded-sm p-2 focus:outline-none focus:border-gold font-display text-sm';
const labelClass = 'block text-xs font-display font-bold text-ink-muted uppercase tracking-widest mb-1';

export default function ProfilePage() {
  const { user, isAuthenticated, isLoading, logout } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);

  // Profile + verification fire together (gated on auth) instead of the old
  // auth-resolves-then-Promise.all waterfall; TanStack Query dedupes/caches them.
  const enabled = isAuthenticated && !!user;
  const { data: profile = null, isPending, error: profileError } = useQuery({
    queryKey: profileKeys.me(),
    queryFn: () => profileService.getProfile(),
    enabled,
  });
  const { data: verificationStatus = null } = useQuery({
    queryKey: profileKeys.verification(),
    queryFn: async () => {
      const v = await apiClient
        .get<{ success: boolean; isVerified: boolean; email: string; verifiedAt?: string }>('/auth/verification-status')
        .catch(() => ({ success: false, isVerified: false, email: '', verifiedAt: undefined }));
      return v.success ? { isVerified: v.isVerified, email: v.email, verifiedAt: v.verifiedAt } : null;
    },
    enabled,
  });
  // Loading until auth resolves AND the profile has loaded.
  const loading = !enabled || isPending;
  const [isResendingVerification, setIsResendingVerification] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    addresses: [] as Address[]
  });
  const [showAddAddress, setShowAddAddress] = useState(false);
  const [newAddress, setNewAddress] = useState<Omit<Address, 'isDefault'>>({
    fullName: '',
    phone: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    postalCode: '',
    country: 'India'
  });

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  // Seed the edit form from the loaded profile — but never clobber in-progress
  // edits, so a background refetch while editing is harmless.
  useEffect(() => {
    if (profile && !editing) {
      setFormData({ name: profile.name, email: profile.email, addresses: profile.addresses });
    }
  }, [profile, editing]);

  // Preserve the old auth-failure redirect (the profile query surfaces it as an error).
  useEffect(() => {
    if (profileError instanceof Error && profileError.message.includes('Not authorized')) {
      router.push('/login?reason=auth_failed');
    }
  }, [profileError, router]);

  const handleEdit = () => setEditing(true);

  const handleCancelEdit = () => {
    setEditing(false);
    if (profile) setFormData({ name: profile.name, email: profile.email, addresses: profile.addresses });
  };

  const handleSave = async () => {
    try {
      const updatedProfile = await profileService.updateProfile(formData);
      queryClient.setQueryData(profileKeys.me(), updatedProfile);
      setEditing(false);
    } catch (error) {
      console.error('Error updating profile:', error);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleAddressChange = (index: number, field: keyof Address, value: string) => {
    setFormData(prev => {
      const newAddresses = [...prev.addresses];
      newAddresses[index] = { ...newAddresses[index], [field]: value };
      return { ...prev, addresses: newAddresses };
    });
  };

  const handleNewAddressChange = (field: keyof Omit<Address, 'isDefault'>, value: string) => {
    setNewAddress(prev => ({ ...prev, [field]: value }));
  };

  const addNewAddress = () => {
    const addressToAdd = { ...newAddress, isDefault: formData.addresses.length === 0 };
    setFormData(prev => ({ ...prev, addresses: [...prev.addresses, addressToAdd] }));
    setNewAddress({ fullName: '', phone: '', addressLine1: '', addressLine2: '', city: '', state: '', postalCode: '', country: 'India' });
    setShowAddAddress(false);
  };

  const removeAddress = (index: number) => {
    setFormData(prev => {
      const newAddresses = [...prev.addresses];
      newAddresses.splice(index, 1);
      return { ...prev, addresses: newAddresses };
    });
  };

  const handleResendVerification = async () => {
    try {
      setIsResendingVerification(true);
      setResendMessage(null);
      const response: any = await apiClient.post('/auth/resend-verification', {});
      if (response.success) setResendMessage('Verification email sent! Please check your inbox.');
      else setResendMessage(response.message || 'Failed to send verification email');
    } catch (error) {
      setResendMessage('Failed to send verification email. Please try again later.');
    } finally {
      setIsResendingVerification(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-obsidian-deep flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gold" />
      </div>
    );
  }

  if (!isAuthenticated || !user) return null;

  return (
    <div className="min-h-screen bg-obsidian-deep py-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-10">
          <p className="font-display text-[10px] uppercase tracking-[0.28em] text-gold">Account</p>
          <h1 className="mt-4 text-[clamp(34px,5vw,60px)] font-light leading-[0.95] tracking-[-0.01em] text-ink">My Profile</h1>
        </div>

        {/* Identity header — name, karma, email, verification */}
        <div className="bg-obsidian border border-hairline rounded-lg p-6 mb-6">
          {/* Avatar + name/email */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <div className="w-20 h-20 bg-obsidian-raised border border-hairline rounded-full flex items-center justify-center shrink-0">
                <User className="h-10 w-10 text-gold" />
              </div>
              <div className="min-w-0">
                <h2 className="text-2xl font-display font-light text-ink tracking-[-0.01em]">
                  {editing ? (
                    <input
                      type="text"
                      name="name"
                      value={formData.name}
                      onChange={handleInputChange}
                      className="bg-transparent border-b border-gold text-ink focus:outline-none font-display font-bold uppercase tracking-wide text-2xl w-full"
                    />
                  ) : (
                    profile?.name
                  )}
                </h2>
                <p className="text-ink/70 font-display mt-1 flex items-center gap-1.5">
                  {editing ? (
                    <input
                      type="email"
                      name="email"
                      value={formData.email}
                      onChange={handleInputChange}
                      className="bg-transparent border-b border-gold text-ink/70 focus:outline-none font-display text-sm w-full"
                    />
                  ) : (
                    <>
                      <span className="truncate">{profile?.email}</span>
                      {verificationStatus?.isVerified && (
                        <span
                          className="inline-flex shrink-0 text-green-400"
                          title={verificationStatus.verifiedAt ? `Email verified on ${new Date(verificationStatus.verifiedAt).toLocaleDateString()}` : 'Email verified'}
                          aria-label="Email verified"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                        </span>
                      )}
                    </>
                  )}
                </p>
              </div>
            </div>
            {!editing && <KarmaBadge />}
          </div>

          {/* Email verification banner — unverified */}
          {verificationStatus && !verificationStatus.isVerified && (
            <div className="mb-6 bg-yellow-500/10 border border-yellow-500/30 rounded-sm p-4">
              <div className="flex items-start gap-3">
                <svg className="h-5 w-5 text-yellow-400 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <div className="flex-1">
                  <h3 className="text-sm font-display font-bold text-yellow-400 uppercase tracking-wide">Email Not Verified</h3>
                  <p className="mt-1 text-sm text-yellow-300/80 font-display">
                    Please verify your email address to access all features. Check your inbox for the verification email.
                  </p>
                  {resendMessage && (
                    <p className={`mt-2 text-sm font-display ${resendMessage.includes('sent') ? 'text-green-400' : 'text-red-400'}`}>
                      {resendMessage}
                    </p>
                  )}
                  <button
                    onClick={handleResendVerification}
                    disabled={isResendingVerification}
                    className="mt-3 inline-flex items-center px-3 py-1.5 border border-yellow-500/40 text-sm font-display font-bold uppercase tracking-widest rounded-sm text-yellow-400 hover:bg-yellow-500/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isResendingVerification ? 'Sending...' : 'Resend Verification Email'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Recent orders — directly under the identity header */}
        <RecentOrdersCard />

        {/* Addresses + account actions */}
        <div className="bg-obsidian border border-hairline rounded-lg p-6 mb-6">
          {/* Addresses */}
          {editing ? (
            <div className="mb-6">
              <h3 className="text-sm font-display font-bold text-ink-muted uppercase tracking-widest mb-4">Addresses</h3>
              {formData.addresses.map((address, index) => (
                <div key={index} className="border border-hairline rounded-sm p-4 mb-4 bg-obsidian-raised">
                  <div className="flex justify-between items-start">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 grow">
                      {(['fullName', 'phone', 'addressLine1', 'addressLine2', 'city', 'state', 'postalCode', 'country'] as const).map((field) => (
                        <div key={field}>
                          <label className={labelClass}>{field === 'addressLine1' ? 'Address Line 1' : field === 'addressLine2' ? 'Address Line 2' : field === 'postalCode' ? 'Postal Code' : field === 'fullName' ? 'Full Name' : field.charAt(0).toUpperCase() + field.slice(1)}</label>
                          <input
                            type="text"
                            value={(address as any)[field] || ''}
                            onChange={(e) => handleAddressChange(index, field, e.target.value)}
                            className={inputClass}
                          />
                        </div>
                      ))}
                    </div>
                    <button onClick={() => removeAddress(index)} className="ml-4 text-red-400 hover:text-red-300 transition-colors">
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              ))}

              {showAddAddress ? (
                <div className="border border-gold/30 rounded-sm p-4 mb-4 bg-obsidian-raised">
                  <h4 className="text-sm font-display font-bold text-gold uppercase tracking-widest mb-4">Add New Address</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {(['fullName', 'phone', 'addressLine1', 'addressLine2', 'city', 'state', 'postalCode', 'country'] as const).map((field) => (
                      <div key={field}>
                        <label className={labelClass}>{field === 'addressLine1' ? 'Address Line 1' : field === 'addressLine2' ? 'Address Line 2' : field === 'postalCode' ? 'Postal Code' : field === 'fullName' ? 'Full Name' : field.charAt(0).toUpperCase() + field.slice(1)}</label>
                        <input
                          type="text"
                          value={(newAddress as any)[field] || ''}
                          onChange={(e) => handleNewAddressChange(field, e.target.value)}
                          className={inputClass}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex gap-3">
                    <button onClick={addNewAddress} className="bg-gold hover:opacity-90 text-obsidian font-display font-bold uppercase tracking-widest px-4 py-2 rounded-sm transition-colors text-sm">
                      Add Address
                    </button>
                    <button onClick={() => setShowAddAddress(false)} className="bg-obsidian-raised hover:bg-obsidian-raised text-ink/70 font-display font-bold uppercase tracking-widest px-4 py-2 rounded-sm transition-colors text-sm">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setShowAddAddress(true)} className="flex items-center gap-2 text-gold hover:text-ink font-display font-bold uppercase tracking-widest text-sm transition-colors mb-4">
                  <Plus className="h-4 w-4" />
                  Add Address
                </button>
              )}
            </div>
          ) : (
            <div className="mb-6">
              <h3 className="text-sm font-display font-bold text-ink-muted uppercase tracking-widest mb-4">Addresses</h3>
              {profile?.addresses && profile.addresses.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {profile.addresses.map((address, index) => (
                    <div key={index} className="border border-hairline rounded-sm p-4 bg-obsidian-raised">
                      <div className="flex items-start gap-3">
                        <MapPin className="h-5 w-5 text-gold mt-0.5 shrink-0" />
                        <div className="font-display text-sm">
                          <p className="font-display font-light text-ink tracking-[-0.01em] mb-1">{address.fullName}</p>
                          <p className="text-ink/70">{address.addressLine1}</p>
                          {address.addressLine2 && <p className="text-ink/70">{address.addressLine2}</p>}
                          <p className="text-ink/70">{address.city}, {address.state} {address.postalCode}</p>
                          <p className="text-ink/70">{address.country}</p>
                          <p className="text-ink-muted">Phone: {address.phone}</p>
                          {address.isDefault && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-display font-bold uppercase tracking-widest bg-gold/10 text-gold border border-gold/30 mt-2">
                              Default
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-ink-muted font-display text-sm">No addresses added yet.</p>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-3 pt-4 border-t border-hairline">
            {editing ? (
              <>
                <button onClick={handleSave} className="bg-gold hover:opacity-90 text-obsidian font-display font-bold uppercase tracking-widest px-4 py-2 rounded-sm transition-colors text-sm">
                  Save Changes
                </button>
                <button onClick={handleCancelEdit} className="bg-obsidian-raised hover:bg-obsidian-raised text-ink/70 font-display font-bold uppercase tracking-widest px-4 py-2 rounded-sm transition-colors text-sm">
                  Cancel
                </button>
              </>
            ) : (
              <button onClick={handleEdit} className="flex items-center gap-2 bg-gold hover:opacity-90 text-obsidian font-display font-bold uppercase tracking-widest px-4 py-2 rounded-sm transition-colors text-sm">
                <Edit className="h-4 w-4" />
                Edit Profile
              </button>
            )}
            {user?.role === 'admin' && (
              <Link href="/admin/dashboard" className="flex items-center gap-2 bg-obsidian-raised hover:bg-gold text-ink/70 hover:text-obsidian font-display font-bold uppercase tracking-widest px-4 py-2 rounded-sm transition-colors text-sm">
                <Shield className="h-4 w-4" />
                Admin Dashboard
              </Link>
            )}
            <button onClick={logout} className="bg-obsidian-raised hover:bg-red-500/20 text-red-400 hover:text-red-300 border border-hairline hover:border-red-500/30 font-display font-bold uppercase tracking-widest px-4 py-2 rounded-sm transition-colors text-sm">
              Logout
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
