'use client';

/**
 * How the bank is identified on a bank transfer: an IFSC (an Indian bank) or a
 * SWIFT code (a foreign bank — e.g. a Thai supplier at KASIKORNBANK, KASITHBK).
 * Exactly one is sent; the server checks the format again (Back-end utils/payee.js).
 */
export type BankCodeKind = 'ifsc' | 'swift';

export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const SWIFT_RE = /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/;

/** As typed, without spaces, upper case — how the server stores it. */
export const cleanCode = (v: string) => v.replace(/\s+/g, '').toUpperCase();

/** A plain-English problem with the code, or '' when it looks right (empty is the `required` check's job). */
export function bankCodeProblem(kind: BankCodeKind, value: string): string {
  const v = cleanCode(value);
  if (!v) return '';
  if (kind === 'ifsc') return IFSC_RE.test(v) ? '' : 'An IFSC is 11 characters, like HDFC0001234.';
  return SWIFT_RE.test(v) ? '' : 'A SWIFT code is 8 or 11 letters and digits, like KASITHBK.';
}

/** What a saved payee is identified by: SWIFT if it has one, IFSC otherwise (every older record). */
export const kindOf = (p: { swift?: string }): BankCodeKind => (p.swift ? 'swift' : 'ifsc');

/** `{ ifsc, swift }` for the payload: the chosen one filled, the other empty. */
export const bankCodePayload = (kind: BankCodeKind, value: string) =>
  (kind === 'swift' ? { ifsc: '', swift: cleanCode(value) } : { ifsc: cleanCode(value), swift: '' });

const toggle = (on: boolean) => `rounded-md px-2.5 py-1 text-xs font-medium ${on ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-600' : 'text-gray-600 hover:bg-gray-100'}`;

export default function BankCodeField({ kind, value, onKind, onChange, inputClass }: {
  kind: BankCodeKind;
  value: string;
  onKind: (k: BankCodeKind) => void;
  onChange: (v: string) => void;
  inputClass: string;
}) {
  const problem = bankCodeProblem(kind, value);
  const id = `bank-code-${kind}`;
  return (
    <div>
      <div className="mb-1 flex gap-1" role="radiogroup" aria-label="Bank code">
        <button type="button" role="radio" aria-checked={kind === 'ifsc'} onClick={() => onKind('ifsc')} className={toggle(kind === 'ifsc')}>IFSC (Indian bank)</button>
        <button type="button" role="radio" aria-checked={kind === 'swift'} onClick={() => onKind('swift')} className={toggle(kind === 'swift')}>SWIFT (foreign bank)</button>
      </div>
      <input
        id={id}
        aria-label={kind === 'swift' ? 'SWIFT code' : 'IFSC'}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? `${id}-problem` : undefined}
        className={inputClass}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={kind === 'swift' ? 'SWIFT code, e.g. KASITHBK' : 'IFSC, e.g. HDFC0001234'}
        autoCapitalize="characters"
        maxLength={14}
      />
      {problem && <p id={`${id}-problem`} className="mt-1 text-xs text-red-700">{problem}</p>}
    </div>
  );
}
