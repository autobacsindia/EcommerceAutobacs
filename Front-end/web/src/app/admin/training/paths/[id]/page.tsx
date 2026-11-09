'use client';

import { use } from 'react';
import PathEditor from '@/components/training/PathEditor';

export default function TrainingPathPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <PathEditor id={id} base="/admin/training" />;
}
