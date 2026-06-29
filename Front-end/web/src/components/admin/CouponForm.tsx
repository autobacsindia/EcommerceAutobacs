'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';

export interface CouponFormValues {
  code: string;
  description: string;
  type: 'percentage' | 'fixed' | 'free_shipping';
  value: number;
  maxDiscountAmount: string;   // kept as string for empty-able numeric inputs
  visibility: 'public' | 'hidden';
  minCartValue: string;
  maxCartValue: string;
  startsAt: string;            // datetime-local
  expiresAt: string;
  firstOrderOnly: boolean;
  usageLimit: string;
  usageLimitPerUser: string;
  isActive: boolean;
}

export const EMPTY_COUPON: CouponFormValues = {
  code: '', description: '', type: 'percentage', value: 10, maxDiscountAmount: '',
  visibility: 'hidden', minCartValue: '', maxCartValue: '', startsAt: '', expiresAt: '',
  firstOrderOnly: false, usageLimit: '', usageLimitPerUser: '', isActive: true,
};

const num = (s: string): number | null => (s.trim() === '' ? null : Number(s));
const toLocalInput = (iso?: string | null) => (iso ? new Date(iso).toISOString().slice(0, 16) : '');

/** Maps an API coupon document into editable form values. */
export function couponToForm(c: any): CouponFormValues {
  return {
    code: c.code || '', description: c.description || '', type: c.type || 'percentage',
    value: c.value ?? 0, maxDiscountAmount: c.maxDiscountAmount != null ? String(c.maxDiscountAmount) : '',
    visibility: c.visibility || 'hidden',
    minCartValue: c.minCartValue ? String(c.minCartValue) : '',
    maxCartValue: c.maxCartValue != null ? String(c.maxCartValue) : '',
    startsAt: toLocalInput(c.startsAt), expiresAt: toLocalInput(c.expiresAt),
    firstOrderOnly: !!c.firstOrderOnly,
    usageLimit: c.usageLimit != null ? String(c.usageLimit) : '',
    usageLimitPerUser: c.usageLimitPerUser != null ? String(c.usageLimitPerUser) : '',
    isActive: c.isActive !== false,
  };
}

const label = 'block text-sm font-medium text-gray-700 mb-1';
const input = 'w-full border border-gray-300 rounded-lg px-3 py-2';

export default function CouponForm({ initial, couponId }: { initial: CouponFormValues; couponId?: string }) {
  const router = useRouter();
  const [v, setV] = useState<CouponFormValues>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof CouponFormValues>(k: K, val: CouponFormValues[K]) => setV(prev => ({ ...prev, [k]: val }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    // Build the API payload — empty numeric inputs become null (= "no limit/condition").
    const payload: any = {
      code: v.code.trim().toUpperCase(),
      description: v.description.trim() || undefined,
      type: v.type,
      value: v.type === 'free_shipping' ? 0 : Number(v.value),
      maxDiscountAmount: v.type === 'percentage' ? num(v.maxDiscountAmount) : null,
      visibility: v.visibility,
      minCartValue: num(v.minCartValue) ?? 0,
      maxCartValue: num(v.maxCartValue),
      startsAt: v.startsAt ? new Date(v.startsAt).toISOString() : null,
      expiresAt: v.expiresAt ? new Date(v.expiresAt).toISOString() : null,
      firstOrderOnly: v.firstOrderOnly,
      usageLimit: num(v.usageLimit),
      usageLimitPerUser: num(v.usageLimitPerUser),
      isActive: v.isActive,
    };
    try {
      if (couponId) await apiClient.put(API_ENDPOINTS.COUPON_DETAIL(couponId), payload);
      else await apiClient.post(API_ENDPOINTS.COUPONS, payload);
      router.push('/admin/coupons');
    } catch (err: any) {
      setError(err.message || 'Failed to save coupon');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="max-w-2xl space-y-5 bg-white p-6 rounded-lg shadow">
      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">{error}</div>}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={label}>Code *</label>
          <input className={`${input} font-mono uppercase`} value={v.code} onChange={(e) => set('code', e.target.value)} required />
        </div>
        <div>
          <label className={label}>Visibility</label>
          <select className={input} value={v.visibility} onChange={(e) => set('visibility', e.target.value as any)}>
            <option value="hidden">Hidden (code only)</option>
            <option value="public">Public (shown at checkout)</option>
          </select>
        </div>
      </div>

      <div>
        <label className={label}>Description</label>
        <input className={input} value={v.description} onChange={(e) => set('description', e.target.value)} />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className={label}>Type</label>
          <select className={input} value={v.type} onChange={(e) => set('type', e.target.value as any)}>
            <option value="percentage">Percentage</option>
            <option value="fixed">Fixed amount</option>
            <option value="free_shipping">Free shipping</option>
          </select>
        </div>
        {v.type !== 'free_shipping' && (
          <div>
            <label className={label}>{v.type === 'percentage' ? 'Percent (%)' : 'Amount (₹)'}</label>
            <input type="number" min={0} className={input} value={v.value} onChange={(e) => set('value', Number(e.target.value))} />
          </div>
        )}
        {v.type === 'percentage' && (
          <div>
            <label className={label}>Max discount (₹)</label>
            <input type="number" min={0} className={input} value={v.maxDiscountAmount} onChange={(e) => set('maxDiscountAmount', e.target.value)} placeholder="No cap" />
          </div>
        )}
      </div>

      <fieldset className="border border-gray-200 rounded-lg p-4">
        <legend className="text-sm font-semibold text-gray-700 px-1">Conditions — “valid when…”</legend>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={label}>Min cart value (₹)</label>
            <input type="number" min={0} className={input} value={v.minCartValue} onChange={(e) => set('minCartValue', e.target.value)} placeholder="e.g. 50000" />
          </div>
          <div>
            <label className={label}>Max cart value (₹)</label>
            <input type="number" min={0} className={input} value={v.maxCartValue} onChange={(e) => set('maxCartValue', e.target.value)} placeholder="No upper bound" />
          </div>
          <div>
            <label className={label}>Starts at</label>
            <input type="datetime-local" className={input} value={v.startsAt} onChange={(e) => set('startsAt', e.target.value)} />
          </div>
          <div>
            <label className={label}>Expires at</label>
            <input type="datetime-local" className={input} value={v.expiresAt} onChange={(e) => set('expiresAt', e.target.value)} />
          </div>
        </div>
        <label className="flex items-center gap-2 mt-3 text-sm text-gray-700">
          <input type="checkbox" checked={v.firstOrderOnly} onChange={(e) => set('firstOrderOnly', e.target.checked)} />
          First order only (requires the customer to be logged in)
        </label>
      </fieldset>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={label}>Total usage limit</label>
          <input type="number" min={0} className={input} value={v.usageLimit} onChange={(e) => set('usageLimit', e.target.value)} placeholder="Unlimited" />
        </div>
        <div>
          <label className={label}>Per-user limit</label>
          <input type="number" min={0} className={input} value={v.usageLimitPerUser} onChange={(e) => set('usageLimitPerUser', e.target.value)} placeholder="Unlimited (requires login)" />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={v.isActive} onChange={(e) => set('isActive', e.target.checked)} />
        Active
      </label>

      <div className="flex gap-3 pt-2">
        <button type="submit" disabled={saving} className="bg-blue-600 text-white px-5 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {saving ? 'Saving…' : couponId ? 'Save changes' : 'Create coupon'}
        </button>
        <button type="button" onClick={() => router.push('/admin/coupons')} className="px-5 py-2 rounded-lg border border-gray-300 hover:bg-gray-50">
          Cancel
        </button>
      </div>
    </form>
  );
}
