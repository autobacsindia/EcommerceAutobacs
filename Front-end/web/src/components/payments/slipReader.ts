'use client';

import { useEffect, useRef, useState } from 'react';
import { postForm } from './api';
import { slipReaderEnabled } from './slipReaderStatus';

/**
 * Reading a payment slip as it is attached (backend: services/slipReader).
 *
 * The server SUGGESTS the UTR / reference, date & time and amount (and shows
 * payer, payee and app or bank). The form fills its boxes with them, a person
 * checks and can change every one, and nothing is saved until they press Save.
 * The `token` goes with the save so the server can record, per field, whether
 * the saved value is what the slip said or what a person typed.
 *
 * If reading is off, slow or fails, the form works exactly as before.
 */

export type SlipFields = {
  reference: string;
  referenceLabel: string;
  otherReferences: string[];
  amount: number | null;
  /** 'YYYY-MM-DD' as printed (IST), '' if not on the slip. */
  date: string;
  /** 'HH:MM', '' if not on the slip. */
  time: string;
  /** ISO instant of date + time, '' if no date. */
  transactionAt: string;
  paymentStatus: 'success' | 'failed' | 'pending' | 'unknown';
  payerName: string;
  payeeName: string;
  payeeAccount: string;
  appOrBank: string;
};

export type SlipWarning = { code: 'amount_mismatch' | 'duplicate_reference' | 'not_successful'; message: string };

export type SlipReadResult =
  | { status: 'read'; fields: SlipFields; warnings: SlipWarning[]; token: string }
  | { status: 'unreadable' | 'failed'; message: string }
  | { status: 'off' };

export type SlipState = 'idle' | 'reading' | SlipReadResult['status'];

/** How a saved field got its value (models/shared/slipReadSchema.js). */
export type SlipSource = 'slip' | 'edited' | 'typed';
export type SlipRead = {
  readAt: string;
  model?: string;
  fields: { reference?: SlipSource; date?: SlipSource; amount?: SlipSource };
} | null;

export { slipReaderEnabled, resetSlipReaderForTests } from './slipReaderStatus';

const readable = (f: File | undefined) => !!f && (f.type.startsWith('image/') || f.type === 'application/pdf' || /\.(pdf|jpe?g|png|webp)$/i.test(f.name));

export async function readSlipFile(file: File, { expectedAmount, excludeId }: { expectedAmount?: number; excludeId?: string } = {}): Promise<SlipReadResult> {
  const form = new FormData();
  form.append('slip', file);
  if (expectedAmount != null && Number.isFinite(expectedAmount) && expectedAmount > 0) form.append('expectedAmount', String(expectedAmount));
  if (excludeId) form.append('excludeId', excludeId);
  return postForm<SlipReadResult>('/slip-reader/read', form);
}

/**
 * Reads the FIRST attached slip once (a new first file is read again). `onRead`
 * gets the suggestions so the form can fill its boxes. A stale answer (the file
 * was removed or swapped while reading) is dropped.
 */
export function useSlipReader({ files, expectedAmount, excludeId, onRead }: {
  files: File[];
  expectedAmount?: number;
  excludeId?: string;
  onRead: (fields: SlipFields) => void;
}) {
  const [state, setState] = useState<SlipState>('idle');
  const [result, setResult] = useState<SlipReadResult | null>(null);
  const readFile = useRef<File | null>(null);
  const onReadRef = useRef(onRead);
  useEffect(() => { onReadRef.current = onRead; });
  const first = files.find(readable);

  useEffect(() => {
    if (!first) {
      readFile.current = null;
      setState('idle');
      setResult(null);
      return undefined;
    }
    if (readFile.current === first) return undefined;
    readFile.current = first;
    let live = true;
    (async () => {
      if (!(await slipReaderEnabled())) { if (live) setState('off'); return; }
      if (!live) return;
      setState('reading');
      setResult(null);
      let res: SlipReadResult;
      try {
        res = await readSlipFile(first, { expectedAmount, excludeId });
      } catch (err) {
        res = { status: 'failed', message: (err as Error)?.message || 'Could not read the slip — please type the details.' };
      }
      if (!live || readFile.current !== first) return;
      setResult(res);
      setState(res.status);
      if (res.status === 'read') onReadRef.current(res.fields);
    })();
    return () => { live = false; };
    // expectedAmount / excludeId are fixed for one form; a new slip is what re-reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [first]);

  const read = result?.status === 'read' ? result : null;
  return {
    state,
    result,
    /** Send with the save as `slipRead` ('' when nothing was read). */
    token: read?.token || '',
    fields: read?.fields || null,
    warnings: read?.warnings || [],
    /** Whether a box still holds what the slip said: 'slip', 'edited', or null (nothing read for it). */
    tag(field: 'reference' | 'date' | 'amount' | 'transactionAt', value: string | number | null | undefined): 'slip' | 'edited' | null {
      if (!read) return null;
      const f = read.fields;
      if (field === 'reference') {
        if (!f.reference) return null;
        const key = (v: unknown) => String(v ?? '').toUpperCase().replace(/[\s\-/]/g, '');
        return key(value) === key(f.reference) ? 'slip' : 'edited';
      }
      if (field === 'amount') {
        if (f.amount == null) return null;
        return Math.round(Number(value) * 100) === Math.round(f.amount * 100) ? 'slip' : 'edited';
      }
      if (!f.date) return null;
      if (field === 'date') return String(value ?? '').slice(0, 10) === f.date ? 'slip' : 'edited';
      // transactionAt: a local 'YYYY-MM-DDTHH:MM' box. Compared on the IST clock.
      const v = String(value ?? '');
      const ist = v ? new Date(new Date(v).getTime() + 330 * 60 * 1000).toISOString() : '';
      const same = ist.slice(0, 10) === f.date && (!f.time || ist.slice(11, 16) === f.time);
      return same ? 'slip' : 'edited';
    },
  };
}

export type SlipReader = ReturnType<typeof useSlipReader>;
