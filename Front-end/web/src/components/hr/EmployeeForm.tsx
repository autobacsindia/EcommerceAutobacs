'use client';

import { useState, type FormEvent } from 'react';
import { describeHrError } from '@/lib/hr/errors';
import type { Employee, EmployeeInput, EmploymentType } from '@/lib/hr/types';
import { hrBtnGhost, hrBtnPrimary, hrInput } from './HrStates';

type Fields = {
  name: string; designation: string; phone: string; workEmail: string; joinDate: string;
  employmentType: EmploymentType; status: 'onboarding' | 'active';
  pan: string; aadhaar: string; uan: string;
  bankHolder: string; bankAccount: string; bankIfsc: string; upi: string;
};

const fromEmployee = (e?: Employee): Fields => ({
  name: e?.name ?? '', designation: e?.designation ?? '', phone: e?.phone ?? '', workEmail: e?.workEmail ?? '',
  joinDate: e?.joinDate ?? '', employmentType: e?.employmentType ?? 'full_time',
  status: e?.status === 'active' ? 'active' : 'onboarding',
  // Write-only: never pre-filled, the server only ever sends the last four.
  pan: '', aadhaar: '', uan: e?.uan ?? '',
  bankHolder: e?.bank.holderName ?? '', bankAccount: '', bankIfsc: e?.bank.ifsc ?? '', upi: '',
});

/**
 * Turn the form into the API body. On edit only CHANGED fields are sent, and the
 * write-only numbers (PAN, Aadhaar, account, UPI) only when typed — so opening
 * and saving a profile never wipes what is on file.
 */
export function buildEmployeeInput(f: Fields, before?: Employee): EmployeeInput {
  const base = fromEmployee(before);
  const out: EmployeeInput = {};
  const changed = (k: keyof Fields) => !before || f[k] !== base[k];
  if (changed('name')) out.name = f.name.trim();
  if (changed('designation')) out.designation = f.designation.trim();
  if (changed('phone')) out.phone = f.phone.trim();
  if (changed('workEmail')) out.workEmail = f.workEmail.trim();
  if (changed('joinDate')) out.joinDate = f.joinDate || null;
  if (changed('employmentType')) out.employmentType = f.employmentType;
  if (changed('status') && (!before || before.status === 'onboarding' || before.status === 'active')) out.status = f.status;
  if (changed('uan')) out.uan = f.uan.trim();
  if (f.pan.trim()) out.pan = f.pan.trim().toUpperCase();
  if (f.aadhaar.trim()) out.aadhaar = f.aadhaar.replace(/\s/g, '');
  const bank: NonNullable<EmployeeInput['bank']> = {};
  if (changed('bankHolder')) bank.holderName = f.bankHolder.trim();
  if (changed('bankIfsc')) bank.ifsc = f.bankIfsc.trim().toUpperCase();
  if (f.bankAccount.trim()) bank.accountNumber = f.bankAccount.replace(/\s/g, '');
  if (f.upi.trim()) bank.upi = f.upi.trim();
  if (Object.keys(bank).length) out.bank = bank;
  return out;
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-gray-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-gray-500">{hint}</span>}
    </label>
  );
}

export default function EmployeeForm({
  employee, onSubmit, onCancel, submitLabel,
}: {
  employee?: Employee;
  onSubmit: (input: EmployeeInput) => Promise<unknown>;
  onCancel?: () => void;
  submitLabel: string;
}) {
  const [f, setF] = useState<Fields>(() => fromEmployee(employee));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Fields>(k: K) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value as Fields[K] }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) { setError('Name is required.'); return; }
    const input = buildEmployeeInput(f, employee);
    if (employee && !Object.keys(input).length) { setError('Nothing has changed.'); return; }
    setSaving(true);
    setError(null);
    try {
      await onSubmit(input);
    } catch (err) {
      setError(describeHrError(err).message);
    } finally {
      setSaving(false);
    }
  };
  const onFile = (last4: string | undefined, what: string) => (last4 ? `On file: •••• ${last4}. Type a new one only to replace it.` : `Not added yet${what ? ` — ${what}` : ''}.`);
  const editableStatus = !employee || employee.status === 'onboarding' || employee.status === 'active';

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-bold text-gray-900">Basic details</legend>
        <Field label="Full name *"><input required value={f.name} onChange={set('name')} className={hrInput} autoComplete="off" /></Field>
        <Field label="Designation"><input value={f.designation} onChange={set('designation')} className={hrInput} /></Field>
        <Field label="Phone"><input value={f.phone} onChange={set('phone')} inputMode="tel" className={hrInput} /></Field>
        <Field label="Work email"><input type="email" value={f.workEmail} onChange={set('workEmail')} className={hrInput} /></Field>
        <Field label="Joining date"><input type="date" value={f.joinDate} onChange={set('joinDate')} className={hrInput} /></Field>
        <Field label="Employment type">
          <select value={f.employmentType} onChange={set('employmentType')} className={hrInput}>
            <option value="full_time">Full time</option><option value="part_time">Part time</option>
            <option value="intern">Intern</option><option value="contract">Contract</option>
          </select>
        </Field>
        {editableStatus && (
          <Field label="Status" hint="Notice and leaving are set from the exit steps, not here.">
            <select value={f.status} onChange={set('status')} className={hrInput}>
              <option value="onboarding">Joining (onboarding)</option><option value="active">Active</option>
            </select>
          </Field>
        )}
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-bold text-gray-900">ID and bank (stored encrypted)</legend>
        <Field label="PAN" hint={onFile(employee?.panLast4, '')}><input value={f.pan} onChange={set('pan')} autoComplete="off" className={hrInput} placeholder={employee?.panLast4 ? `•••• ${employee.panLast4}` : 'ABCDE1234F'} /></Field>
        <Field label="Aadhaar" hint={employee?.aadhaarLast4 ? `On file: •••• ${employee.aadhaarLast4}. Only the last 4 digits are kept.` : 'Only the last 4 digits are kept.'}><input value={f.aadhaar} onChange={set('aadhaar')} inputMode="numeric" autoComplete="off" className={hrInput} /></Field>
        <Field label="UAN (PF)"><input value={f.uan} onChange={set('uan')} inputMode="numeric" className={hrInput} /></Field>
        <Field label="Account holder name"><input value={f.bankHolder} onChange={set('bankHolder')} className={hrInput} /></Field>
        <Field label="Bank account number" hint={onFile(employee?.bank.accountLast4, '')}><input value={f.bankAccount} onChange={set('bankAccount')} inputMode="numeric" autoComplete="off" className={hrInput} placeholder={employee?.bank.accountLast4 ? `•••• ${employee.bank.accountLast4}` : ''} /></Field>
        <Field label="IFSC"><input value={f.bankIfsc} onChange={set('bankIfsc')} className={hrInput} /></Field>
        <Field label="UPI ID" hint={employee?.bank.hasUpi ? 'A UPI ID is on file. Type a new one only to replace it.' : undefined}><input value={f.upi} onChange={set('upi')} autoComplete="off" className={hrInput} /></Field>
      </fieldset>

      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className={hrBtnPrimary} disabled={saving}>{saving ? 'Saving…' : submitLabel}</button>
        {onCancel && <button type="button" className={hrBtnGhost} onClick={onCancel} disabled={saving}>Cancel</button>}
      </div>
    </form>
  );
}
