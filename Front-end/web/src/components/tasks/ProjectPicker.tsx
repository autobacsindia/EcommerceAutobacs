'use client';

/**
 * The "Project" field of a task (and the colours projects use). Kept apart from
 * Projects.tsx so the task form and task page can use it without pulling in
 * the Projects screens.
 */
import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { taskKeys } from '@/hooks/queries/keys';
import type { ProjectPick } from './types';

export const PROJECT_COLOURS = ['blue', 'violet', 'pink', 'red', 'orange', 'amber', 'green', 'teal', 'gray'] as const;
const DOT: Record<string, string> = {
  gray: 'bg-gray-400', red: 'bg-red-500', orange: 'bg-orange-500', amber: 'bg-amber-500', green: 'bg-green-600',
  teal: 'bg-teal-500', blue: 'bg-blue-600', violet: 'bg-violet-600', pink: 'bg-pink-500',
};
export const projectDot = (colour?: string) => DOT[colour || 'blue'] || DOT.blue;

/** The projects this person sees, by name: for a task's "Project" picker. */
export function useProjectPick(enabled = true) {
  return useQuery({
    queryKey: taskKeys.projectPick(),
    queryFn: () => apiClient.get<{ projects: ProjectPick[] }>('/staff/tasks/projects/pick').then((r) => r.projects),
    staleTime: 60_000,
    enabled,
  });
}

/**
 * The project a task is in, as a picker (or plain text for someone who may not
 * move it). Offers only the projects this person sees: the server refuses the rest.
 */
export function ProjectPicker({ value, onChange, disabled = false, className = '' }: {
  value: string | null | undefined; onChange: (projectId: string | null) => void; disabled?: boolean; className?: string;
}) {
  const pick = useProjectPick();
  const list = pick.data ?? [];
  const current = list.find((p) => p.id === value);
  if (pick.isPending) return <span className="text-sm text-gray-400">…</span>;
  // In a project this person does not see (they see the task some other way): say so plainly.
  if (value && !current) return <span className="text-sm text-gray-500">In a project</span>;
  if (!list.length) return <span className="text-sm text-gray-400">No projects yet</span>;
  return (
    <span className={`inline-flex min-w-0 max-w-full items-center gap-1.5 ${className}`}>
      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-sm ${current ? projectDot(current.colour) : 'border border-gray-400'}`} />
      <select
        value={current ? current.id : ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || null)}
        aria-label="Project"
        title={current?.name}
        className={`min-w-0 max-w-full truncate rounded-md border-transparent! bg-transparent! py-0.5 text-sm text-gray-800 ${disabled ? 'cursor-default appearance-none pr-1' : 'pr-6 hover:border-gray-200!'}`}
      >
        <option value="">No project</option>
        {list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </span>
  );
}

