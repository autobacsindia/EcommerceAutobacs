'use client';

import { useAuth } from '@/context/AuthContext';
import DeliveryFeesEditor from '@/components/admin/DeliveryFeesEditor';
import { API_ENDPOINTS } from '@/lib/constants';
import { deliveryFeeKeys } from '@/hooks/queries/keys';

/**
 * Delivery fees in the team panel: procurement copies the real courier rates in
 * (₹/kg and small-parcel ₹ per slab by distance, packing, freight…). The on/off
 * switches stay admin-only — the API enforces both rules.
 */
export default function TeamDeliveryFeesPage() {
  const { user } = useAuth();
  if (user?.staff?.team !== 'procurement') {
    return <p className="text-sm text-gray-600">Delivery fees are kept by procurement.</p>;
  }
  return (
    <DeliveryFeesEditor
      endpoint={API_ENDPOINTS.STAFF_DELIVERY_FEES}
      queryKey={deliveryFeeKeys.staff()}
      canEditSwitches={false}
      showRemotePins={false}
    />
  );
}
