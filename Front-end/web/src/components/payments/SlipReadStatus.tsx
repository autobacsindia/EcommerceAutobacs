'use client';

import { AlertTriangle, Loader2, ScanText } from 'lucide-react';
import { rupees } from './api';
import type { SlipRead, SlipReader, SlipSource } from './slipReader';

/**
 * What the slip reader is doing, under the file picker: reading, what it read
 * (payer → payee, app or bank, other IDs), warnings, or why staff should type.
 * Nothing at all when reading is off or no slip is attached.
 */
export default function SlipReadStatus({ slip, expectedAmount }: {
  slip: SlipReader;
  /** What this payment is for, in rupees: checked live against the slip (the total can change as rows are ticked). */
  expectedAmount?: number;
}) {
  const { state, result, fields } = slip;
  let { warnings } = slip;
  if (fields && expectedAmount != null) {
    warnings = warnings.filter((w) => w.code !== 'amount_mismatch');
    if (fields.amount != null && expectedAmount > 0 && Math.round(fields.amount * 100) !== Math.round(expectedAmount * 100)) {
      warnings = [...warnings, {
        code: 'amount_mismatch',
        message: `The slip shows ${rupees(fields.amount)}, but this payment is ${rupees(expectedAmount)}. Check the slip before saving.`,
      }];
    }
  }
  if (state === 'idle' || state === 'off') return null;
  if (state === 'reading') {
    return (
      <p role="status" className="mt-2 flex items-center gap-2 text-sm text-gray-600">
        <Loader2 className="h-4 w-4 animate-spin" /> Reading the slip… you can keep typing.
      </p>
    );
  }
  if (!fields) {
    const message = result && 'message' in result ? result.message : 'Could not read the slip — please type the details.';
    return <p role="status" className="mt-2 text-sm text-gray-600">{message}</p>;
  }
  const people = [fields.payerName, fields.payeeName].filter(Boolean).join(' → ');
  const extra = [
    people,
    fields.appOrBank,
    fields.amount != null ? `${rupees(fields.amount)} on the slip` : '',
    fields.otherReferences.length ? `other IDs: ${fields.otherReferences.join(', ')}` : '',
  ].filter(Boolean).join(' · ');
  return (
    <div className="mt-2 space-y-2">
      <p role="status" className="flex items-start gap-2 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900">
        <ScanText className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          <strong>Read from slip — please check.</strong> Change anything that is wrong before saving.
          {extra && <span className="block text-sky-800">{extra}</span>}
        </span>
      </p>
      {warnings.map((w) => (
        <p key={w.code} role="alert"
          className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${w.code === 'duplicate_reference' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900'}`}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {w.message}
        </p>
      ))}
    </div>
  );
}

/** A small label beside a box filled from the slip: "read from slip" or "changed". */
export function SlipFieldTag({ source }: { source: 'slip' | 'edited' | null }) {
  if (!source) return null;
  return source === 'slip'
    ? <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 text-[11px] font-medium text-sky-800">read from slip — check</span>
    : <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-700">changed from slip</span>;
}

const SOURCE_TEXT: Record<SlipSource, string> = { slip: 'read from slip', edited: 'changed by a person', typed: 'typed by a person' };
const FIELD_TEXT = { reference: 'UTR / reference', date: 'Date', amount: 'Amount' } as const;

/**
 * For accounts and the admin: which saved fields were read automatically and
 * which a person typed or changed. Decided by the server on save.
 */
export function SlipSources({ slipRead }: { slipRead?: SlipRead }) {
  if (!slipRead?.fields) return null;
  const rows = (Object.keys(FIELD_TEXT) as (keyof typeof FIELD_TEXT)[])
    .filter((k) => slipRead.fields[k])
    .map((k) => ({ k, source: slipRead.fields[k] as SlipSource }));
  if (!rows.length) return null;
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-xs text-gray-600" aria-label="Where these details came from">
      <ScanText className="h-3.5 w-3.5" /> Slip read automatically:
      {rows.map(({ k, source }) => (
        <span key={k}
          className={`rounded px-1.5 py-0.5 ${source === 'slip' ? 'bg-sky-50 text-sky-800' : 'bg-amber-50 text-amber-900'}`}>
          {FIELD_TEXT[k]} — {SOURCE_TEXT[source]}
        </span>
      ))}
    </p>
  );
}
