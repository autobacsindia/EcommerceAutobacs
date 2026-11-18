'use client';

/**
 * "Repeats": how often a task comes back by itself (ClickUp's "recurring").
 * The owner's example: Monthly office supply purchase, every month on the 1st.
 *
 * Nothing here is optimistic — the server checks the rule, works out every
 * next date (IST, month ends) and makes the next copy when the task is done
 * (Back-end/server/services/taskRepeat.js). This is only the picker.
 */
import { useState } from 'react';
import { REPEAT_EVERY_MAX, repeatText, type RepeatInput, type RepeatUnit } from './types';

const UNIT_CHOICES: { value: RepeatUnit | 'never'; label: string }[] = [
  { value: 'never', label: 'Never' },
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
];
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
const UNIT_WORD: Record<RepeatUnit, [string, string]> = { day: ['day', 'days'], week: ['week', 'weeks'], month: ['month', 'months'] };

/** The day of the month of a 'YYYY-MM-DD' date, or 1. */
const dayOf = (dueOn?: string | null) => (dueOn && /^\d{4}-\d{2}-\d{2}$/.test(dueOn) ? Number(dueOn.slice(8)) : 1);

/**
 * The picker itself. `value` null means "Never". A monthly rule starts on the
 * due date's day, so picking "Monthly" on a task due the 1st reads
 * "Every month on the 1st" straight away.
 */
export function RepeatPicker({ value, onChange, dueOn, disabled = false, idPrefix = 'repeat' }: {
  value: RepeatInput | null; onChange: (next: RepeatInput | null) => void; dueOn?: string | null; disabled?: boolean; idPrefix?: string;
}) {
  const unit = value?.unit ?? 'never';
  const every = value?.every ?? 1;
  const pickUnit = (next: string) => {
    if (next === 'never') { onChange(null); return; }
    const u = next as RepeatUnit;
    onChange({ unit: u, every, ...(u === 'month' ? { day: value?.day ?? dayOf(dueOn) } : {}) });
  };
  const pickEvery = (raw: string) => {
    const n = Math.round(Number(raw));
    if (!value) return;
    onChange({ ...value, every: Number.isFinite(n) ? Math.min(REPEAT_EVERY_MAX, Math.max(1, n)) : 1 });
  };
  const selectCls = 'rounded-md border border-gray-200 bg-white px-2 py-1 text-sm text-gray-900 disabled:opacity-60';
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-sm text-gray-700">
      <select aria-label="Repeats" id={`${idPrefix}-unit`} value={unit} disabled={disabled} onChange={(e) => pickUnit(e.target.value)} className={selectCls}>
        {UNIT_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
      </select>
      {value && (
        <>
          <span>every</span>
          <input
            type="number"
            aria-label="Repeat every"
            min={1}
            max={REPEAT_EVERY_MAX}
            value={every}
            disabled={disabled}
            onChange={(e) => pickEvery(e.target.value)}
            className="w-14 rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-900"
          />
          <span>{UNIT_WORD[value.unit][every === 1 ? 0 : 1]}</span>
        </>
      )}
      {value?.unit === 'month' && (
        <>
          <span>on the</span>
          <select aria-label="Day of the month" value={value.day ?? dayOf(dueOn)} disabled={disabled} onChange={(e) => onChange({ ...value, day: Number(e.target.value) })} className={selectCls}>
            {DAYS.map((d) => <option key={d} value={d}>{repeatText({ unit: 'month', every: 1, day: d }).replace('Every month on the ', '')}</option>)}
          </select>
        </>
      )}
      {value?.unit === 'month' && (value.day ?? 0) > 28 && (
        <span className="basis-full text-xs text-gray-500">In shorter months it is due on the last day.</span>
      )}
    </span>
  );
}

/**
 * The task page's "Repeats" field: the rule in words; whoever may edit the task
 * changes it in a small editor and saves once (one request, one history line).
 */
export function RepeatField({ value, dueOn, canEdit, saving, onSave }: {
  value: RepeatInput | null; dueOn: string | null; canEdit: boolean; saving: boolean; onSave: (next: RepeatInput | null) => void;
}) {
  const [draft, setDraft] = useState<RepeatInput | null | undefined>(undefined);
  const words = value ? repeatText(value) : 'Never';
  if (draft === undefined) {
    const cls = value ? 'text-gray-900' : 'text-gray-400';
    if (!canEdit) return <span className={cls}>{words}</span>;
    return (
      <button type="button" onClick={() => setDraft(value)} disabled={saving} aria-label={`Repeats: ${words}. Change`} className={`rounded-md px-1 py-0.5 text-left hover:bg-gray-100 ${cls}`}>
        {words}
      </button>
    );
  }
  const unchanged = (draft ? repeatText(draft) : 'Never') === words;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <RepeatPicker value={draft} onChange={setDraft} dueOn={dueOn} disabled={saving} idPrefix="task-repeat" />
      <span className="flex gap-1">
        <button type="button" disabled={saving || unchanged} onClick={() => { onSave(draft); setDraft(undefined); }} className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50">Save</button>
        <button type="button" onClick={() => setDraft(undefined)} className="rounded-md px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100">Cancel</button>
      </span>
    </span>
  );
}
