'use client';

import { useMemo, useState } from 'react';
import RichTextBox from '@/components/ui/RichTextBox';
import { errorMessage } from '@/components/staff/sales/types';
import { useLessonMeta } from './hooks';
import type { LessonDraft } from './types';

const field = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900';

interface Props {
  initial: LessonDraft;
  /** Who it is for and who owns it are for managers; a named owner edits the words. */
  canManage: boolean;
  submitLabel: string;
  onSubmit: (draft: LessonDraft) => Promise<unknown>;
  onCancel: () => void;
}

export default function LessonForm({ initial, canManage, submitLabel, onSubmit, onCancel }: Props) {
  const meta = useLessonMeta();
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (patch: Partial<LessonDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const audiences = useMemo(() => {
    const options = meta.data?.postTo ?? [];
    // A lesson's current home stays listed even where this person could not post anew.
    return options.some((o) => o.key === initial.audience) || !initial.audience
      ? options
      : [{ key: initial.audience, label: meta.data?.sections.find((s) => s.key === initial.audience)?.label ?? initial.audience }, ...options];
  }, [meta.data, initial.audience]);
  const owners = (meta.data?.people ?? []).filter((p) => draft.audience === 'company' || p.isAdmin || p.team === draft.audience);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!draft.title.trim()) { setError('Give the lesson a title.'); return; }
    if (!draft.audience) { setError('Choose who the lesson is for.'); return; }
    setSaving(true);
    setError('');
    try {
      await onSubmit(draft);
    } catch (err) {
      setError(errorMessage(err, 'The lesson could not be saved. Please try again.'));
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="max-w-3xl space-y-4">
      <div>
        <label htmlFor="lesson-title" className="mb-1 block text-sm font-medium text-gray-800">Title</label>
        <input id="lesson-title" className={field} maxLength={140} value={draft.title} onChange={(e) => set({ title: e.target.value })} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {canManage && (
          <div>
            <label htmlFor="lesson-audience" className="mb-1 block text-sm font-medium text-gray-800">Who can see it</label>
            <select id="lesson-audience" className={field} value={draft.audience} onChange={(e) => set({ audience: e.target.value, ownerId: '' })}>
              <option value="">Choose…</option>
              {audiences.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </div>
        )}
        <div>
          <label htmlFor="lesson-topic" className="mb-1 block text-sm font-medium text-gray-800">Job or topic (optional)</label>
          <input id="lesson-topic" className={field} maxLength={60} placeholder="For example: GTM lead" value={draft.topic} onChange={(e) => set({ topic: e.target.value })} />
        </div>
        {canManage && (
          <div>
            <label htmlFor="lesson-owner" className="mb-1 block text-sm font-medium text-gray-800">Who keeps it up to date</label>
            <select id="lesson-owner" className={field} value={draft.ownerId} onChange={(e) => set({ ownerId: e.target.value })}>
              <option value="">{initial.title ? 'Keep the current owner' : 'Me'}</option>
              {owners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}
      </div>
      <div>
        <p className="mb-1 text-sm font-medium text-gray-800">Notes</p>
        <RichTextBox value={draft.body} onChange={(body) => set({ body })} ariaLabel="Lesson notes" placeholder="Explain the work, step by step" maxLength={50000} minHeightClass="min-h-[14rem]" />
        <p className="mt-1 text-xs text-gray-600">Never write passwords here. Everyone who can see this lesson can read it.</p>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {saving ? 'Saving…' : submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-800">Cancel</button>
      </div>
    </form>
  );
}
