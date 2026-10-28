'use client';

import { Suspense } from 'react';
import TasksWorkspace from '@/components/tasks/TasksWorkspace';

/** Admin: give a task to anyone in any team, and follow every team's tasks. */
export default function AdminTasksPage() {
  return (
    <div className="max-w-6xl p-4 md:p-6">
      <Suspense fallback={null}>
        <TasksWorkspace base="/admin/tasks" canSeeTeam />
      </Suspense>
    </div>
  );
}
