'use client';

import { useParams } from 'next/navigation';
import TaskDetail from '@/components/tasks/TaskDetail';

/** Admin: one task. */
export default function AdminTaskPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <div className="max-w-3xl p-4 md:p-6">
      <TaskDetail id={id} base="/admin/tasks" />
    </div>
  );
}
