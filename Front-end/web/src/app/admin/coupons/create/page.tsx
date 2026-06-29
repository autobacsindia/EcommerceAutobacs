'use client';

import CouponForm, { EMPTY_COUPON } from '@/components/admin/CouponForm';

export default function CreateCouponPage() {
  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-6">New Coupon</h1>
      <CouponForm initial={EMPTY_COUPON} />
    </div>
  );
}
