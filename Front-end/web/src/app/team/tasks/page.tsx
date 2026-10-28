'use client';

import { Suspense } from 'react';
import { useAuth } from '@/context/AuthContext';
import TasksWorkspace from '@/components/tasks/TasksWorkspace';

/**
 * Tasks: what I have to do, what I gave out, and — for a team head — the whole
 * team's. Heads give tasks to their team; members add tasks for themselves.
 */
export default function TeamTasksPage() {
  const { user } = useAuth();
  return (
    <div className="max-w-6xl">
      <Suspense fallback={null}>
        <TasksWorkspace base="/team/tasks" canSeeTeam={user?.staff?.isHead === true} />
      </Suspense>
    </div>
  );
}
