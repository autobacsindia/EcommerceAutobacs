'use client';

/**
 * A task's description: shown formatted, and edited in place with the
 * formatting box. Click the text (not a link) or the pencil to edit; Save or
 * Ctrl/⌘ + Enter keeps it, Cancel or Esc leaves it as it was.
 */

import { useState } from 'react';
import { Pencil } from 'lucide-react';
import RichText from '@/components/ui/RichText';
import RichTextBox from '@/components/ui/RichTextBox';
import { isRichTextEmpty } from '@/lib/richText';
import { Linkified } from './links';

export default function InlineRichText({ value, onSave, placeholder, label, className, canEdit, maxLength }: {
  value: string; onSave: (v: string) => void; placeholder: string; label: string;
  className: string; canEdit: boolean; maxLength: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = (
    <RichText
      value={value}
      plain={(s) => <Linkified text={s} />}
    />
  );

  if (!canEdit) return value ? <div className={className}>{shown}</div> : null;

  if (draft === null) {
    if (!value) {
      return (
        <button type="button" onClick={() => setDraft('')} aria-label={`Edit ${label}`} className={`${className} group w-full rounded-md text-left text-gray-400 hover:bg-gray-50`}>
          {placeholder}
          <Pencil aria-hidden className="ml-1.5 inline h-3.5 w-3.5 text-gray-300 opacity-0 group-hover:opacity-100" />
        </button>
      );
    }
    return (
      <div
        // A link opens; a click anywhere else edits.
        onClick={(e) => { if (!(e.target as HTMLElement).closest('a,input')) setDraft(value); }}
        className={`${className} group relative cursor-text rounded-md hover:bg-gray-50`}
      >
        {shown}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setDraft(value); }}
          aria-label={`Edit ${label}`}
          title="Edit"
          className="absolute right-1 top-1 inline-flex rounded p-0.5 text-gray-300 opacity-0 hover:bg-gray-100 hover:text-gray-600 focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Pencil aria-hidden className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  const unchanged = draft === value || (isRichTextEmpty(draft) && !value);
  const commit = () => {
    const next = isRichTextEmpty(draft) ? '' : draft.trim();
    setDraft(null);
    if (next !== value.trim()) onSave(next);
  };
  return (
    <div className="space-y-2">
      <RichTextBox
        value={draft}
        onChange={setDraft}
        ariaLabel={label}
        placeholder={placeholder}
        maxLength={maxLength}
        autoFocus
        minHeightClass="min-h-[7rem]"
        onSubmit={commit}
        onKeyDownFirst={(e) => {
          // Esc closes only when nothing would be lost.
          if (e.key === 'Escape' && unchanged) { e.preventDefault(); setDraft(null); return true; }
          return false;
        }}
      />
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={() => setDraft(null)} className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
        <button type="button" onClick={commit} disabled={unchanged} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40">Save</button>
      </div>
    </div>
  );
}
