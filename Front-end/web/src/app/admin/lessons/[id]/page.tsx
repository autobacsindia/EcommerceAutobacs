'use client';

import { use } from 'react';
import LessonDetail from '@/components/lessons/LessonDetail';

export default function LessonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <LessonDetail id={id} base="/admin/lessons" />;
}
