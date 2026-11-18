'use client';

import DeliveryFeesEditor from '@/components/admin/DeliveryFeesEditor';
import { API_ENDPOINTS } from '@/lib/constants';
import { deliveryFeeKeys } from '@/hooks/queries/keys';

/** Admin → Delivery fees: the full editor, switches and remote-PIN list included. */
export default function DeliveryFeesAdminPage() {
  return (
    <DeliveryFeesEditor
      endpoint={API_ENDPOINTS.DELIVERY_FEES_ADMIN}
      queryKey={deliveryFeeKeys.admin()}
      canEditSwitches
      showRemotePins
    />
  );
}
