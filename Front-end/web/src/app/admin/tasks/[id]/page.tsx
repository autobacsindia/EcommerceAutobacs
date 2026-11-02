'use client';

import { useParams } from 'next/navigation';
import TaskDetail from '@/components/tasks/TaskDetail';

/** Admin: one task. */
export default function AdminTaskPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <div className="tk-theme">
      <div className="mx-auto max-w-3xl rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-7">
        <TaskDetail id={id} base="/admin/tasks" />
      </div>
    </div>
  );
}
