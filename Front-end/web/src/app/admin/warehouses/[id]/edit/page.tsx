'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import WarehouseForm from '../../WarehouseForm';
import warehouseService, { WarehouseFormData } from '@/services/warehouseService';

export default function EditWarehousePage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const [initialData, setInitialData] = useState<Partial<WarehouseFormData> | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    warehouseService
      .getWarehouse(id)
      .then(res => {
        const w = res.warehouse;
        // GeoJSON stores [longitude, latitude]; the form edits them as separate fields.
        const [lng, lat] = w.location.coordinates?.coordinates ?? [];
        setInitialData({
          name: w.name,
          code: w.code,
          type: w.type,
          location: {
            address: w.location.address,
            city: w.location.city,
            state: w.location.state,
            postalCode: w.location.postalCode,
            country: w.location.country,
            latitude: typeof lat === 'number' ? lat : '',
            longitude: typeof lng === 'number' ? lng : '',
          },
          serviceablePinCodes: w.serviceablePinCodes,
          operationalStatus: w.operationalStatus,
          contactInfo: w.contactInfo,
          capacity: w.capacity,
        });
      })
      .catch(err => setError(err.message || 'Failed to load warehouse'));
  }, [id]);

  if (error) return <div className="p-6 text-red-600">{error}</div>;
  if (!initialData) return <div className="p-6 text-gray-500">Loading...</div>;

  return (
    <WarehouseForm
      mode="edit"
      warehouseId={id}
      initialData={initialData}
      onSuccess={() => router.push('/admin/warehouses')}
    />
  );
}
