'use client';

import { use } from 'react';
import TrainingDetail from '@/components/training/TrainingDetail';

export default function TrainingAssignmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <TrainingDetail id={id} base="/admin/training" />;
}
