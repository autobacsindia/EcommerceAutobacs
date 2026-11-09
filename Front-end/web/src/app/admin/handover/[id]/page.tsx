'use client';

import { use } from 'react';
import HandoverDetail from '@/components/handover/HandoverDetail';

export default function HandoverRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <HandoverDetail id={id} base="/admin/handover" />;
}
