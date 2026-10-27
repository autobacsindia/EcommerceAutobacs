'use client';

import { Suspense } from 'react';
import { useAuth } from '@/context/AuthContext';
import TaskList from '@/components/tasks/TaskList';

/**
 * Tasks: what I have to do, what I gave out, and — for a team head — the whole
 * team's. Heads give tasks to their team; members add tasks for themselves.
 */
export default function TeamTasksPage() {
  const { user } = useAuth();
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900">Tasks</h1>
      <p className="mb-6 text-sm text-gray-500">Work given to people in the team, with a due date and a status. Open a task to comment on it.</p>
      <Suspense fallback={null}>
        <TaskList base="/team/tasks" canSeeTeam={user?.staff?.isHead === true} />
      </Suspense>
    </div>
  );
}
