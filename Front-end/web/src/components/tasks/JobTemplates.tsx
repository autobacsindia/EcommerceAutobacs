'use client';

/**
 * Job templates (services/staffJobTemplateService.js): "Save as job template"
 * on a project, and "Start from" in the New project form. A template carries
 * a project's columns, lists and usual tasks — never people, comments, time,
 * files, job details or money. The server decides who may save, use or delete
 * one; these controls only hide what it would refuse.
 */
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { CopyPlus, Loader2, Trash2 } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { taskKeys } from '@/hooks/queries/keys';
import { errorMessage } from '@/components/staff/sales/types';
import { Dialog } from './Overlays';
import type { Project } from './types';

export type JobTemplate = {
  id: string;
  name: string;
  colour: string;
  columns: string[];
  lists: string[];
  taskCount: number;
  /** The first few task titles, for a preview. */
  tasks: string[];
  fromProject: string;
  createdByName: string;
  can: { delete: boolean };
};

/** What the server says it made from a template, for the "Project created" message. */
export type FromTemplate = { name: string; tasks: number; movedEarlier: number; failed: { title: string; reason: string }[] };

export function useJobTemplates(enabled = true) {
  return useQuery({
    queryKey: taskKeys.jobTemplates(),
    queryFn: () => apiClient.get<{ templates: JobTemplate[] }>('/staff/tasks/projects/job-templates').then((r) => r.templates),
    enabled,
  });
}

/** The message after a project is made from a template: what came in, and anything that didn't. */
export function fromTemplateMessage(f: FromTemplate) {
  const parts = [`Project created from “${f.name}” with ${f.tasks} ${f.tasks === 1 ? 'task' : 'tasks'}.`];
  if (f.movedEarlier) parts.push(`${f.movedEarlier} due ${f.movedEarlier === 1 ? 'date was' : 'dates were'} moved earlier to fit the due-date rules.`);
  if (f.failed.length) parts.push(`${f.failed.length} could not be added: ${f.failed.map((x) => x.title).join(', ')}.`);
  return parts.join(' ');
}

/**
 * "Start from" in the New project form: a blank project, or one of the
 * templates. Shows what the chosen one brings, and lets its author or the
 * admin delete it.
 */
export function TemplatePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const queryClient = useQueryClient();
  const templates = useJobTemplates();
  const list = templates.data ?? [];
  const chosen = list.find((t) => t.id === value);
  const remove = useMutation({
    mutationFn: (t: JobTemplate) => apiClient.delete(`/staff/tasks/projects/job-templates/${encodeURIComponent(t.id)}`),
    onSuccess: (_r, t) => { toast.success(`Template “${t.name}” deleted. Projects made from it keep everything.`); onChange(''); },
    onError: (e) => toast.error(errorMessage(e, 'Could not delete the template.')),
    onSettled: () => queryClient.invalidateQueries({ queryKey: taskKeys.jobTemplates() }),
  });
  // No templates yet: nothing to pick, and the form stays as it was.
  if (!list.length) return null;
  return (
    <div className="space-y-1.5 rounded-lg border border-gray-200 bg-gray-50 p-3">
      <label className="block text-xs font-medium text-gray-500">
        <span className="mb-1 block">Start from</span>
        <select value={chosen ? value : ''} onChange={(e) => onChange(e.target.value)} aria-label="Start from" className="w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm text-gray-900">
          <option value="">A blank project</option>
          {list.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.taskCount} {t.taskCount === 1 ? 'task' : 'tasks'})</option>)}
        </select>
      </label>
      {chosen && (
        <div className="space-y-1 text-xs text-gray-700">
          {chosen.columns.length > 0 && <p><span className="font-medium">Columns:</span> {chosen.columns.join(' · ')}</p>}
          {chosen.lists.length > 0 && <p><span className="font-medium">Lists:</span> {chosen.lists.join(' · ')}</p>}
          {chosen.tasks.length > 0 && (
            <p><span className="font-medium">Tasks:</span> {chosen.tasks.join(', ')}{chosen.taskCount > chosen.tasks.length ? ` and ${chosen.taskCount - chosen.tasks.length} more` : ''}</p>
          )}
          <p className="text-gray-500">
            Every task goes to the project’s owner, due the same number of days after the start date as in the original.
            {chosen.fromProject && ` Saved from ${chosen.fromProject}${chosen.createdByName ? ` by ${chosen.createdByName}` : ''}.`}
          </p>
          {chosen.can.delete && (
            <button
              type="button"
              onClick={() => { if (window.confirm(`Delete the template “${chosen.name}”? Projects already made from it keep everything.`)) remove.mutate(chosen); }}
              disabled={remove.isPending}
              className="inline-flex items-center gap-1 font-medium text-red-700 hover:underline disabled:opacity-50"
            >
              <Trash2 aria-hidden className="h-3.5 w-3.5" /> Delete this template
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** "Save as job template" on a project (its owner, the admin). */
export function SaveAsTemplate({ p }: { p: Project }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: () => apiClient.post<{ template: JobTemplate }>(`/staff/tasks/projects/${encodeURIComponent(p.id)}/template`, { name: name.trim() }),
    onSuccess: (r) => {
      toast.success(`Saved as “${r.template.name}” with ${r.template.taskCount} ${r.template.taskCount === 1 ? 'task' : 'tasks'}. Pick it in New project.`);
      setOpen(false);
      return queryClient.invalidateQueries({ queryKey: taskKeys.jobTemplates() });
    },
    onError: (e) => setError(errorMessage(e, 'Could not save the template.')),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (name.trim() && !save.isPending) save.mutate();
  };
  return (
    <>
      <button
        type="button"
        onClick={() => { setName(''); setError(''); setOpen(true); }}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        <CopyPlus aria-hidden className="h-3.5 w-3.5" /> Save as template
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} label="Save as job template">
        {open && (
          <form onSubmit={submit} className="space-y-4 rounded-2xl bg-white p-4 shadow-xl">
            <h2 className="text-base font-semibold text-gray-900">Save “{p.name}” as a job template</h2>
            <label className="block text-sm font-medium text-gray-700">
              Template name
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                placeholder="e.g. Fitting job"
                className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-2 text-sm text-gray-900"
              />
            </label>
            <div className="space-y-1 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-700">
              <p><span className="font-medium">Saved:</span> the columns, the lists, and each task’s title, notes, checklist, tags, priority, list, column and how many days after the start it is due.</p>
              <p><span className="font-medium">Not saved:</span> people, comments, time, files, the job details and money.</p>
            </div>
            {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={!name.trim() || save.isPending} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {save.isPending && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />} Save template
              </button>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
