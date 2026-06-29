'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import CouponForm, { couponToForm, type CouponFormValues } from '@/components/admin/CouponForm';

export default function EditCouponPage() {
  const params = useParams();
  const id = params?.id as string;
  const [initial, setInitial] = useState<CouponFormValues | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient.get<{ success: boolean; coupon: any }>(API_ENDPOINTS.COUPON_DETAIL(id))
      .then(r => setInitial(couponToForm(r.coupon)))
      .catch(err => setError(err.message || 'Failed to load coupon'));
  }, [id]);

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-6">Edit Coupon</h1>
      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm max-w-2xl">{error}</div>}
      {initial ? <CouponForm initial={initial} couponId={id} /> : !error && <div>Loading…</div>}
    </div>
  );
}
