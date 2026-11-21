'use client';

/**
 * A company card as the way to pay (expense requests): WHICH card, never the card.
 *
 * PCI DSS: no full card number, expiry or CVV is ever asked for. The last-4 box
 * takes exactly 4 digits; a pasted full number is refused on the spot (not cut
 * down to its first 4 digits, which would be the wrong digits) and never kept.
 * The server checks again (Back-end utils/payee.js).
 */
import { useState } from 'react';

export type PayMethod = 'upi' | 'bank' | 'card' | '';

export const CARD_TYPES = { credit: 'Credit', debit: 'Debit' } as const;
export const CARD_NETWORKS = { visa: 'Visa', mastercard: 'Mastercard', rupay: 'RuPay', amex: 'Amex' } as const;
export const LAST4_ONLY = 'Only the last 4 digits of the card — never the full card number.';

export type CardDetails = { cardType: string; cardNetwork: string; cardLast4: string; cardName: string; cardLabel: string };
export const EMPTY_CARD: CardDetails = { cardType: '', cardNetwork: '', cardLast4: '', cardName: '', cardLabel: '' };

/** The last-4 value after a keystroke or paste: the digits, or an error (and the value is not taken). */
export function nextLast4(typed: string): { value: string } | { error: string } {
  const digits = typed.replace(/\D/g, '');
  if (digits.length > 4) return { error: LAST4_ONLY };
  return { value: digits };
}

/** A plain-English problem with the last 4, or '' when it looks right or is empty (it is optional). */
export const last4Problem = (v: string) => (!v || /^\d{4}$/.test(v) ? '' : 'Enter all 4 of the last 4 digits (e.g. 4821).');

/** "Visa credit ••••4821 · HDFC corporate card"; '' when nothing is known. */
export function cardLabelOf(p: Partial<CardDetails>): string {
  const what = [
    CARD_NETWORKS[p.cardNetwork as keyof typeof CARD_NETWORKS],
    CARD_TYPES[p.cardType as keyof typeof CARD_TYPES]?.toLowerCase(),
    p.cardLast4 ? `••••${p.cardLast4}` : '',
  ].filter(Boolean).join(' ');
  return [what, p.cardLabel].filter(Boolean).join(' · ');
}

export const cardPayload = (c: CardDetails) => ({
  cardType: c.cardType, cardNetwork: c.cardNetwork, cardLast4: c.cardLast4.trim(), cardName: c.cardName.trim(), cardLabel: c.cardLabel.trim(),
});

export default function CardFields({ value, onChange, inputClass }: {
  value: CardDetails;
  onChange: (v: CardDetails) => void;
  inputClass: string;
}) {
  const [refused, setRefused] = useState('');
  const set = (k: keyof CardDetails) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onChange({ ...value, [k]: e.target.value });
  const problem = refused || last4Problem(value.cardLast4);
  return (
    <div className="mt-2 grid gap-3 sm:grid-cols-2">
      <select aria-label="Card type" className={inputClass} value={value.cardType} onChange={set('cardType')}>
        <option value="">Credit or debit (optional)</option>
        {Object.entries(CARD_TYPES).map(([v, l]) => <option key={v} value={v}>{l} card</option>)}
      </select>
      <select aria-label="Card network" className={inputClass} value={value.cardNetwork} onChange={set('cardNetwork')}>
        <option value="">Network (optional)</option>
        {Object.entries(CARD_NETWORKS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <div>
        <input
          aria-label="Card last 4 digits"
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? 'card-last4-problem' : undefined}
          className={inputClass}
          inputMode="numeric"
          autoComplete="off"
          value={value.cardLast4}
          onChange={(e) => {
            const next = nextLast4(e.target.value);
            if ('error' in next) { setRefused(next.error); return; } // the long number is never kept
            setRefused('');
            onChange({ ...value, cardLast4: next.value });
          }}
          placeholder="Last 4 digits only, e.g. 4821"
        />
        {problem && <p id="card-last4-problem" role="alert" className="mt-1 text-xs text-red-700">{problem}</p>}
      </div>
      <input aria-label="Name on card" className={inputClass} maxLength={120} autoComplete="off" value={value.cardName} onChange={set('cardName')} placeholder="Name on card (optional)" />
      <input aria-label="Which company card" className={`${inputClass} sm:col-span-2`} maxLength={60} autoComplete="off" value={value.cardLabel} onChange={set('cardLabel')} placeholder="Which company card, e.g. HDFC corporate card (optional)" />
      <p className="text-xs text-gray-500 sm:col-span-2">Never type the full card number, expiry date or CVV.</p>
    </div>
  );
}
