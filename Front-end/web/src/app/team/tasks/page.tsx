'use client';

import { Suspense } from 'react';
import { useAuth } from '@/context/AuthContext';
import TasksWorkspace from '@/components/tasks/TasksWorkspace';

/**
 * Tasks: what I have to do, what I assigned to others, and my team's space — its folders,
 * lists and every task in it. Anyone in the panel gives tasks to anyone; the team
 * head arranges the space.
 */
export default function TeamTasksPage() {
  const { user } = useAuth();
  return (
    <div>
      <Suspense fallback={null}>
        <TasksWorkspace
          base="/team/tasks"
          // Everyone in a team sees its space, like a chat space; the head also arranges it.
          canSeeTeam={!!user?.staff?.team}
          myTeam={user?.staff?.team ?? null}
          myTeamLabel={user?.staff?.teamLabel ?? ''}
          isHead={user?.staff?.isHead === true}
        />
      </Suspense>
    </div>
  );
}
