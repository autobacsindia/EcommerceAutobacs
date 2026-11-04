'use client';

/**
 * Trash: deleted tasks, newest first, each with Restore. Deleting only archives
 * a task on the server, so everything here comes back whole — comments, files,
 * time and sub-tasks included. Same request (and cache) as the workspace's own
 * "previous / next" order.
 */
import { RotateCcw, Trash2 } from 'lucide-react';
import { errorMessage } from '@/components/staff/sales/types';
import { useTaskPages } from './hooks';
import TaskMenu, { useRestoreTask } from './TaskMenu';
import { timeAgo } from './Comments';
import { AvatarStack, SkeletonRows } from './ui';
import { peopleOf, type Task, type TaskFilters } from './types';

function TrashRow({ t, base, onOpen }: { t: Task; base: string; onOpen: (id: string) => void }) {
  const restore = useRestoreTask();
  return (
    <li
      role="button"
      tabIndex={0}
      onClick={() => onOpen(t.id)}
      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); onOpen(t.id); } }}
      aria-label={`Open ${t.code}: ${t.title}`}
      className="tk-more-host group flex cursor-pointer items-center gap-3 border-t border-gray-100 px-3 py-2.5 first:border-t-0 hover:bg-gray-50 focus-visible:bg-blue-50 focus:outline-none"
    >
      <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-400"><Trash2 className="h-3.5 w-3.5" /></span>
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-gray-700">{t.title}</span>
          <span className="shrink-0 font-mono text-[11px] text-gray-400">{t.code}</span>
        </p>
        <p className="mt-0.5 text-xs text-gray-500">
          {t.teamLabel}{t.archivedAt && <> · deleted {timeAgo(t.archivedAt)}</>}
        </p>
      </div>
      <span className="hidden sm:block"><AvatarStack people={peopleOf(t)} size="sm" /></span>
      {t.can.restore && (
        <button
          type="button"
          disabled={restore.isPending}
          onClick={(e) => { e.stopPropagation(); restore.mutate(t); }}
          onKeyDown={(e) => e.stopPropagation()}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 text-[13px] font-semibold text-gray-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50"
        >
          <RotateCcw aria-hidden className="h-3.5 w-3.5" /> Restore
        </button>
      )}
      <TaskMenu t={t} base={base} onOpen={onOpen} />
    </li>
  );
}

export default function TrashList({ filters, base, onOpen }: { filters: TaskFilters; base: string; onOpen: (id: string) => void }) {
  const pages = useTaskPages(filters, 'archived');
  if (pages.isLoading) return <SkeletonRows rows={5} />;
  if (pages.isError) return <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage(pages.error, 'Could not load Trash.')}</p>;
  const rows = pages.data?.pages.flatMap((p) => p.tasks) ?? [];
  if (!rows.length) {
    return (
      <div className="tk-empty flex flex-col items-center rounded-xl border border-dashed border-gray-200 px-6 py-14 text-center">
        <span aria-hidden className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 text-gray-400"><Trash2 className="h-6 w-6" /></span>
        <p className="font-semibold text-gray-900">{filters.q ? 'Nothing in Trash matches' : 'Trash is empty'}</p>
        <p className="mt-1 max-w-sm text-sm text-gray-500">Deleted tasks land here. Restore one and it comes back with its comments, files and time.</p>
      </div>
    );
  }
  return (
    <div className="space-y-3 pb-20">
      <ul className="tk-sheet overflow-hidden rounded-xl bg-white">
        {rows.map((t) => <TrashRow key={t.id} t={t} base={base} onOpen={onOpen} />)}
      </ul>
      {pages.hasNextPage && (
        <button onClick={() => pages.fetchNextPage()} disabled={pages.isFetchingNextPage} className="w-full rounded-lg py-2 text-sm font-medium text-blue-700 hover:bg-blue-50">
          {pages.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}
