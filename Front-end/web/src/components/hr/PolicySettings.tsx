'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hrApi } from '@/lib/hr/api';
import { hrKeys } from '@/lib/hr/keys';
import { describeHrError } from '@/lib/hr/errors';
import { paise } from '@/lib/hr/format';
import { policyText } from '@/lib/hr/policyText';
import type { HrSettings, PolicySettingsInput, Shift } from '@/lib/hr/types';
import StatusChip from './StatusChip';
import { useHrList } from './useHrList';
import { HrEmpty, HrErrorState, HrLoadMore, HrLoading, HrPageHeader, hrBtnPrimary, hrCard, hrInput } from './HrStates';

type Msg = { ok: boolean; text: string } | null;

/** One number box with its plain-English example under it. */
function RuleField({
  id, label, value, onChange, min, max, step = 1, suffix, example,
}: {
  id: string; label: string; value: string; onChange: (v: string) => void;
  min: number; max: number; step?: number; suffix?: string; example: ReactNode;
}) {
  return (
    <div className="text-sm">
      <label htmlFor={id} className="mb-1 block font-medium text-gray-700">{label}</label>
      <div className="flex items-center gap-2">
        <input
          id={id} type="number" inputMode="decimal" min={min} max={max} step={step}
          value={value} onChange={(e) => onChange(e.target.value)} className={`${hrInput} max-w-[9rem]`}
          aria-describedby={`${id}-ex`}
        />
        {suffix && <span className="text-gray-500">{suffix}</span>}
      </div>
      <p id={`${id}-ex`} className="mt-1 text-xs text-gray-600">{example}</p>
    </div>
  );
}

/** Whole number in range, else an error sentence. */
function wholeIn(raw: string, min: number, max: number, label: string): number | string {
  const v = Number(raw);
  if (raw.trim() === '' || !Number.isInteger(v) || v < min || v > max) return `${label}: enter a whole number from ${min} to ${max}.`;
  return v;
}

const SHIFT_FIELDS = [
  { key: 'graceMinutes', label: 'Late grace', suffix: 'min', min: 0, max: 120 },
  { key: 'earlyGraceMinutes', label: 'Early-leaving grace', suffix: 'min', min: 0, max: 120 },
  { key: 'absentBelowMinutes', label: 'Absent if worked under', suffix: 'min', min: 0, max: 1440 },
  { key: 'halfDayMinMinutes', label: 'Half day if worked under', suffix: 'min', min: 0, max: 1440 },
  { key: 'overtimeAfterMinutes', label: 'Overtime after', suffix: 'min', min: 1, max: 1440 },
] as const;
type ShiftKey = (typeof SHIFT_FIELDS)[number]['key'];

const SHIFT_DEFAULTS: Record<ShiftKey, number> = {
  graceMinutes: 10, earlyGraceMinutes: 10, absentBelowMinutes: 120, halfDayMinMinutes: 270, overtimeAfterMinutes: 540,
};

/**
 * The form remounts when the server's rev changes (so it shows what the server
 * now holds); the message lives in the parent so "Saved." survives that.
 */
function ShiftRules({ shift, msg, setMsg }: { shift: Shift; msg: Msg; setMsg: (m: Msg) => void }) {
  const qc = useQueryClient();
  const initial = Object.fromEntries(SHIFT_FIELDS.map(({ key }) => [key, String(shift[key] ?? SHIFT_DEFAULTS[key])])) as Record<ShiftKey, string>;
  const [f, setF] = useState(initial);
  const save = useMutation({
    mutationFn: (input: Partial<Record<ShiftKey, number>>) => hrApi.updateShift(shift.id, shift.rev, input),
    onSuccess: () => { setMsg({ ok: true, text: 'Saved.' }); qc.invalidateQueries({ queryKey: hrKeys.shifts() }); },
    onError: (err) => {
      const v = describeHrError(err);
      setMsg({ ok: false, text: v.message });
      if (v.kind === 'conflict') qc.invalidateQueries({ queryKey: hrKeys.shifts() });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const changed: Partial<Record<ShiftKey, number>> = {};
    for (const { key, label, min, max } of SHIFT_FIELDS) {
      const v = wholeIn(f[key], min, max, label);
      if (typeof v === 'string') { setMsg({ ok: false, text: v }); return; }
      if (v !== Number(initial[key])) changed[key] = v;
    }
    if (Number(f.absentBelowMinutes) > Number(f.halfDayMinMinutes)) {
      setMsg({ ok: false, text: 'The absent limit must be lower than the half-day limit.' }); return;
    }
    if (!Object.keys(changed).length) { setMsg({ ok: true, text: 'Nothing has changed.' }); return; }
    setMsg(null);
    save.mutate(changed);
  };
  const num = (k: ShiftKey) => Number(f[k]);
  const examples: Record<ShiftKey, string> = {
    graceMinutes: policyText.grace(shift.start, num('graceMinutes')),
    earlyGraceMinutes: policyText.earlyGrace(shift.end, num('earlyGraceMinutes')),
    absentBelowMinutes: policyText.absentBelow(num('absentBelowMinutes')),
    halfDayMinMinutes: policyText.halfDayMin(num('halfDayMinMinutes'), num('absentBelowMinutes')),
    overtimeAfterMinutes: policyText.overtimeAfter(num('overtimeAfterMinutes')),
  };
  return (
    <form noValidate onSubmit={submit} className={`${hrCard} p-4`} aria-label={`Rules for ${shift.name}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="font-semibold text-gray-900">{shift.name} <span className="font-normal text-gray-500">· {shift.start} – {shift.end}</span></p>
        <span className="flex gap-1">{shift.isDefault && <StatusChip tone="info">Default</StatusChip>}{!shift.active && <StatusChip tone="muted">Off</StatusChip>}</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {SHIFT_FIELDS.map(({ key, label, suffix, min, max }) => (
          <RuleField
            key={key} id={`${shift.id}-${key}`} label={label} suffix={suffix} min={min} max={max}
            value={f[key]} onChange={(v) => setF((p) => ({ ...p, [key]: v }))} example={examples[key]}
          />
        ))}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button type="submit" className={hrBtnPrimary} disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save shift rules'}</button>
        {msg && <p role={msg.ok ? 'status' : 'alert'} className={`text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.text}</p>}
      </div>
    </form>
  );
}

function ShiftsSection() {
  const list = useHrList<Shift>(hrKeys.shifts(), (cursor) => hrApi.listShifts(cursor));
  const [msgs, setMsgs] = useState<Record<string, Msg>>({});
  return (
    <section aria-labelledby="hr-day-rules" className="mb-8">
      <h2 id="hr-day-rules" className="mb-1 text-lg font-bold text-gray-900">Day rules (per shift)</h2>
      <p className="mb-3 text-sm text-gray-600">Late or leaving early gives 1 mark. A day too short to count is a half day or absent instead.</p>
      {list.isError ? <HrErrorState error={list.error} onRetry={() => list.refetch()} /> : list.isPending ? <HrLoading /> : !list.rows.length ? (
        <HrEmpty title="No shifts yet">Until a shift is added, the default rules apply: 10 min grace, half day under 4 h 30 min, overtime after 9 h.</HrEmpty>
      ) : (
        // Remount a card when the server's rev changes, so it shows what the server now holds.
        <div className="grid gap-4 lg:grid-cols-2">{list.rows.map((s) => (
          <ShiftRules key={`${s.id}:${s.rev}`} shift={s} msg={msgs[s.id] ?? null} setMsg={(m) => setMsgs((p) => ({ ...p, [s.id]: m }))} />
        ))}</div>
      )}
      <HrLoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()} />
    </section>
  );
}

const rupeesOf = (p: number) => String(Math.round((Number(p) || 0) / 100));

function MonthRulesForm({ settings, msg, setMsg }: { settings: HrSettings; msg: Msg; setMsg: (m: Msg) => void }) {
  const qc = useQueryClient();
  const initial = {
    marksPerHalfDayLop: String(settings.marksPerHalfDayLop ?? 3),
    overtimeMultiplier: String(settings.overtimeMultiplier ?? 2),
    bonusRupees: rupeesOf(settings.punctualityBonusPaise ?? 50000),
    punctualityFullMaxMarks: String(settings.punctualityFullMaxMarks ?? 2),
    punctualityHalfMaxMarks: String(settings.punctualityHalfMaxMarks ?? 4),
  };
  const [f, setF] = useState(initial);
  const save = useMutation({
    mutationFn: (input: PolicySettingsInput) => hrApi.updatePolicy(settings.rev, input),
    onSuccess: (res) => { qc.setQueryData(hrKeys.settings(), res); setMsg({ ok: true, text: 'Saved.' }); },
    onError: (err) => {
      const v = describeHrError(err);
      setMsg({ ok: false, text: v.message });
      if (v.kind === 'conflict') qc.invalidateQueries({ queryKey: hrKeys.settings() });
    },
  });
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const marks = wholeIn(f.marksPerHalfDayLop, 0, 31, 'Marks per ½ day');
    const full = wholeIn(f.punctualityFullMaxMarks, 0, 62, 'Full bonus up to');
    const half = wholeIn(f.punctualityHalfMaxMarks, 0, 62, 'Half bonus up to');
    const rupees = wholeIn(f.bonusRupees, 0, 100000, 'Punctuality bonus');
    const mult = Number(f.overtimeMultiplier);
    const err = [marks, full, half, rupees].find((v) => typeof v === 'string');
    if (err) { setMsg({ ok: false, text: err as string }); return; }
    if (f.overtimeMultiplier.trim() === '' || !Number.isFinite(mult) || mult < 1 || mult > 5) {
      setMsg({ ok: false, text: 'Overtime rate: enter a number from 1 to 5.' }); return;
    }
    if ((half as number) < (full as number)) { setMsg({ ok: false, text: 'Half bonus limit must be the same as or above the full bonus limit.' }); return; }
    const next: Required<PolicySettingsInput> = {
      marksPerHalfDayLop: marks as number,
      overtimeMultiplier: mult,
      // Rupees typed by HR → integer paise for the server. This is the setting, not anyone's pay.
      punctualityBonusPaise: (rupees as number) * 100,
      punctualityFullMaxMarks: full as number,
      punctualityHalfMaxMarks: half as number,
    };
    const changed: PolicySettingsInput = {};
    (Object.keys(next) as (keyof typeof next)[]).forEach((k) => {
      if (next[k] !== settings[k]) (changed as Record<string, number>)[k] = next[k];
    });
    if (!Object.keys(changed).length) { setMsg({ ok: true, text: 'Nothing has changed.' }); return; }
    setMsg(null);
    save.mutate(changed);
  };

  const bonusText = policyText.bonus(
    paise(Number(f.bonusRupees) * 100 || 0), Number(f.punctualityFullMaxMarks), Number(f.punctualityHalfMaxMarks),
  );
  return (
    <form noValidate onSubmit={submit} className={`${hrCard} grid gap-4 p-4 sm:grid-cols-2`} aria-label="Month rules">
      <RuleField id="marksPerHalfDayLop" label="Marks per ½ day cut" min={0} max={31} value={f.marksPerHalfDayLop}
        onChange={set('marksPerHalfDayLop')} suffix="marks" example={policyText.marksPerHalfDay(Number(f.marksPerHalfDayLop))} />
      <RuleField id="overtimeMultiplier" label="Overtime rate" min={1} max={5} step={0.25} value={f.overtimeMultiplier}
        onChange={set('overtimeMultiplier')} suffix="× hourly" example={policyText.overtimeMultiplier(Number(f.overtimeMultiplier))} />
      <RuleField id="bonusRupees" label="Punctuality bonus" min={0} max={100000} value={f.bonusRupees}
        onChange={set('bonusRupees')} suffix="₹ a month" example={bonusText} />
      <div className="grid gap-4 sm:grid-cols-2">
        <RuleField id="punctualityFullMaxMarks" label="Full bonus up to" min={0} max={62} value={f.punctualityFullMaxMarks}
          onChange={set('punctualityFullMaxMarks')} suffix="marks" example={`0–${f.punctualityFullMaxMarks || 0} marks: full bonus.`} />
        <RuleField id="punctualityHalfMaxMarks" label="Half bonus up to" min={0} max={62} value={f.punctualityHalfMaxMarks}
          onChange={set('punctualityHalfMaxMarks')} suffix="marks" example={`More than ${f.punctualityHalfMaxMarks || 0} marks: no bonus.`} />
      </div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button type="submit" className={hrBtnPrimary} disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save month rules'}</button>
        {msg && <p role={msg.ok ? 'status' : 'alert'} className={`text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.text}</p>}
      </div>
    </form>
  );
}

function MonthRulesSection() {
  const q = useQuery({ queryKey: hrKeys.settings(), queryFn: () => hrApi.getSettings(), retry: false });
  const [msg, setMsg] = useState<Msg>(null);
  return (
    <section aria-labelledby="hr-month-rules">
      <h2 id="hr-month-rules" className="mb-1 text-lg font-bold text-gray-900">Month rules (everyone)</h2>
      <p className="mb-3 text-sm text-gray-600">Counted over the payroll month. Payroll works out the rupees; each payslip line shows the count behind it.</p>
      {q.isPending ? <HrLoading /> : q.isError ? <HrErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <MonthRulesForm key={q.data.settings.rev} settings={q.data.settings} msg={msg} setMsg={setMsg} />
      )}
    </section>
  );
}

export default function PolicySettings() {
  return (
    <div className="max-w-5xl">
      <HrPageHeader title="Attendance rules" sub="Changes apply to days and months not yet locked. Every change is logged." />
      <ShiftsSection />
      <MonthRulesSection />
    </div>
  );
}
