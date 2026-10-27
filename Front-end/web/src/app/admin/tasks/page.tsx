'use client';

import { Suspense } from 'react';
import TaskList from '@/components/tasks/TaskList';

/** Admin: give a task to anyone in any team, and follow every team's tasks. */
export default function AdminTasksPage() {
  return (
    <div className="max-w-4xl p-4 md:p-6">
      <h1 className="text-2xl font-bold text-gray-900">Tasks</h1>
      <p className="mb-6 text-sm text-gray-500">Give work to anyone in the staff panel and see where every team&apos;s tasks stand.</p>
      <Suspense fallback={null}>
        <TaskList base="/admin/tasks" canSeeTeam />
      </Suspense>
    </div>
  );
}
