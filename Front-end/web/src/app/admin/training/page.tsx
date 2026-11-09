'use client';

import { Suspense } from 'react';
import TrainingHome from '@/components/training/TrainingHome';

export default function TrainingPage() {
  return <Suspense fallback={null}><TrainingHome base="/admin/training" /></Suspense>;
}
