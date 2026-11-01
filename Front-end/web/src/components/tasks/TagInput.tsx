'use client';

import { useId, useState } from 'react';
import { TagChip } from './ui';
import { useKnownTags } from './hooks';
import { TAGS_MAX, TAG_MAX, cleanTag } from './types';

/**
 * Tags as chips plus a box to type more: Enter or a comma adds one, Backspace in
 * the empty box removes the last. Suggests tags already used on loaded tasks.
 * Cleans each tag the way the server will, so what is shown is what is saved.
 */
export default function TagInput({ value, onChange, disabled = false, label = 'Tags' }: {
  value: string[]; onChange: (tags: string[]) => void; disabled?: boolean; label?: string;
}) {
  const [draft, setDraft] = useState('');
  const listId = useId();
  const known = useKnownTags().filter((t) => !value.includes(t));
  const full = value.length >= TAGS_MAX;
  const add = (raw: string) => {
    const tag = cleanTag(raw);
    setDraft('');
    if (tag && !value.includes(tag) && !full) onChange([...value, tag]);
  };
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1 rounded-lg border border-gray-200 bg-white px-1.5 py-1 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
      {value.map((tag) => <TagChip key={tag} tag={tag} onRemove={disabled ? undefined : () => onChange(value.filter((x) => x !== tag))} />)}
      {!disabled && !full && (
        <input
          value={draft}
          onChange={(e) => { if (e.target.value.endsWith(',')) add(e.target.value.slice(0, -1)); else setDraft(e.target.value); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); add(draft); }
            if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={() => { if (draft.trim()) add(draft); }}
          list={listId}
          maxLength={TAG_MAX + 1}
          placeholder={value.length ? 'Add tag' : 'e.g. supplier, kochi'}
          aria-label={label}
          className="h-7 min-w-[7rem] flex-1 border-0! bg-transparent! px-1 text-sm shadow-none! outline-none focus:ring-0!"
        />
      )}
      {full && <span className="px-1 text-xs text-gray-500">{TAGS_MAX} tags at most</span>}
      <datalist id={listId}>{known.map((t) => <option key={t} value={t} />)}</datalist>
    </div>
  );
}
