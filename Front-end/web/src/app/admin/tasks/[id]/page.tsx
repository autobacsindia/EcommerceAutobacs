'use client';

import { useParams } from 'next/navigation';
import TaskDetail from '@/components/tasks/TaskDetail';

/** Admin: one task. */
export default function AdminTaskPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <div className="p-4 md:p-6">
      <div className="max-w-3xl rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-7">
        <TaskDetail id={id} base="/admin/tasks" />
      </div>
    </div>
  );
}
