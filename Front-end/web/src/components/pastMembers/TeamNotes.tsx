'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import RichText from '@/components/ui/RichText';
import RichTextBox from '@/components/ui/RichTextBox';
import { errorMessage } from '@/components/staff/sales/types';
import { primaryButton, quietButton } from '@/components/training/types';
import { useAddNote, useDeleteNote, useEditNote, usePastMemberNotes } from './hooks';
import { dateLabel, type PastMemberNote } from './types';

const MAX = 5000;

function Note({ memberId, n }: { memberId: string; n: PastMemberNote }) {
  const edit = useEditNote(memberId);
  const remove = useDeleteNote(memberId);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(n.body);
  const save = () => edit.mutate({ noteId: n.id, body: text, rev: n.rev }, {
    onSuccess: () => { setEditing(false); toast.success('Note saved'); },
    onError: (e) => toast.error(errorMessage(e, 'The note could not be saved. Your text is still here.')),
  });
  const del = () => {
    if (!window.confirm('Delete this note? This cannot be undone.')) return;
    remove.mutate(n.id, { onError: (e) => toast.error(errorMessage(e, 'The note could not be deleted.')) });
  };
  return (
    <li className="py-3">
      {editing ? (
        <>
          <RichTextBox value={text} onChange={setText} ariaLabel="Edit note" maxLength={MAX} />
          <div className="mt-2 flex gap-2">
            <button type="button" className={primaryButton} disabled={edit.isPending} onClick={save}>Save</button>
            <button type="button" className={quietButton} onClick={() => { setEditing(false); setText(n.body); }}>Cancel</button>
          </div>
        </>
      ) : <RichText value={n.body} className="text-sm" />}
      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-gray-500">
        <span>{n.authorName || 'Someone'}, {dateLabel(n.createdAt)}{n.editedAt ? ' (edited)' : ''}</span>
        {n.can.edit && !editing && <button type="button" className="text-blue-700 hover:underline" onClick={() => setEditing(true)}>Edit</button>}
        {n.can.delete && !editing && <button type="button" className="text-red-700 hover:underline" disabled={remove.isPending} onClick={del}>Delete</button>}
      </div>
    </li>
  );
}

/** What the team head and admins want the next person to know about someone who left. */
export default function TeamNotes({ memberId }: { memberId: string }) {
  const notes = usePastMemberNotes(memberId);
  const add = useAddNote(memberId);
  const [text, setText] = useState('');
  const rows = notes.data?.pages.flatMap((p) => p.notes) ?? [];
  const canWrite = notes.data?.pages[0]?.canWrite === true;
  const submit = () => add.mutate(text, {
    onSuccess: () => { setText(''); toast.success('Note added'); },
    onError: (e) => toast.error(errorMessage(e, 'The note could not be saved. Your text is still here.')),
  });
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="mb-1 font-semibold text-gray-900">Team notes</h2>
      <p className="mb-3 text-sm text-gray-600">Written by the team head and admins, for whoever joins next.</p>
      {canWrite && (
        <div className="mb-3">
          <RichTextBox value={text} onChange={setText} ariaLabel="New note" placeholder="Customers they looked after, what worked, what to watch out for" maxLength={MAX} />
          <p className="mt-1 text-xs text-gray-600">Everyone on the team can read this. Never write passwords or private details.</p>
          <button type="button" className={`${primaryButton} mt-2`} disabled={add.isPending} onClick={submit}>Add note</button>
        </div>
      )}
      {notes.isLoading && <p className="text-sm text-gray-600">Loading…</p>}
      {notes.isError && <p className="text-sm text-red-700">Notes could not be loaded. <button type="button" className="underline" onClick={() => void notes.refetch()}>Try again</button></p>}
      {notes.isSuccess && !rows.length && <p className="text-sm text-gray-600">No notes yet.</p>}
      {rows.length > 0 && <ul className="divide-y divide-gray-100">{rows.map((n) => <Note key={`${n.id}-${n.rev}`} memberId={memberId} n={n} />)}</ul>}
      {notes.hasNextPage && (
        <button type="button" className={`${quietButton} mt-3`} disabled={notes.isFetchingNextPage} onClick={() => void notes.fetchNextPage()}>
          {notes.isFetchingNextPage ? 'Loading…' : 'Show more'}
        </button>
      )}
    </section>
  );
}
