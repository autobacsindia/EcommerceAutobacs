'use client';

import { useParams } from 'next/navigation';
import TaskDetail from '@/components/tasks/TaskDetail';

/** One task (opened from the list, a pop-up or the bell). */
export default function TeamTaskPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <div className="max-w-3xl">
      <TaskDetail id={id} base="/team/tasks" />
    </div>
  );
}
