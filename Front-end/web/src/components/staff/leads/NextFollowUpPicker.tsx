'use client';

import { useMemo, useState } from 'react';
import { formatDateTimeIST } from '@/lib/datetime';
import { fromIstInput, nextChoices, toIstInput } from './nextFollowUp';

/**
 * Quick choices plus a date-and-time box, all in India time. Reports an ISO
 * string, or '' while nothing is chosen. The server has the final say (office
 * hours), and the card shows what it saved.
 */
export default function NextFollowUpPicker({ id, value, onChange, label = 'Next follow-up by' }: {
  id: string;
  value: string;
  onChange: (iso: string) => void;
  label?: string;
}) {
  const choices = useMemo(() => nextChoices(), []);
  const [custom, setCustom] = useState('');
  const picked = choices.find((c) => c.at.toISOString() === value)?.key ?? (value ? 'custom' : '');
  const min = useMemo(() => toIstInput(new Date()), []);

  return (
    <fieldset>
      <legend className="text-sm font-medium text-gray-800">{label} <span className="text-red-600">(required)</span></legend>
      <div role="radiogroup" aria-label={label} className="mt-1.5 flex flex-wrap gap-2">
        {choices.map((c) => (
          <button key={c.key} type="button" role="radio" aria-checked={picked === c.key}
            onClick={() => { setCustom(''); onChange(c.at.toISOString()); }}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium ${picked === c.key ? 'border-blue-300 bg-blue-50 text-blue-800 ring-2 ring-blue-500' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
            {c.label}
          </button>
        ))}
      </div>
      <label htmlFor={id} className="mt-2 block text-xs text-gray-600">Or pick a date and time (India time)</label>
      <input id={id} type="datetime-local" min={min} value={custom}
        onChange={(e) => { setCustom(e.target.value); onChange(fromIstInput(e.target.value)); }}
        className="mt-1 w-full max-w-xs rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
      {value && <p className="mt-1 text-xs text-gray-600">Due {formatDateTimeIST(value)}. A time outside 10 am – 7 pm (Mon – Sat) moves to the next opening.</p>}
    </fieldset>
  );
}
