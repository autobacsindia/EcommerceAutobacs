'use client';

import { useRouter } from 'next/navigation';
import WarehouseForm from '../WarehouseForm';

export default function CreateWarehousePage() {
  const router = useRouter();
  return (
    <WarehouseForm
      mode="create"
      onSuccess={() => router.push('/admin/warehouses')}
    />
  );
}
