'use client';

import { Suspense } from 'react';
import TasksWorkspace from '@/components/tasks/TasksWorkspace';

/** Admin: give a task to anyone in any team, and follow every team's tasks. */
export default function AdminTasksPage() {
  return (
    <div>
      <Suspense fallback={null}>
        <TasksWorkspace base="/admin/tasks" canSeeTeam />
      </Suspense>
    </div>
  );
}
