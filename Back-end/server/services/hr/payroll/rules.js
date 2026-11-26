/**
 * The payroll rules in force, from HrSettings with the owner's defaults
 * (2026-11-26) for any value HrSettings doesn't carry yet. The run snapshots
 * the result, so a later settings change never rewrites a past month.
 *
 * Fields read from HrSettings (added by the attendance-policy session or the
 * lead; until then the defaults below apply):
 *   marksPerHalfDayLop, overtimeMultiplier, punctualityBonusPaise,
 *   punctualityBonusFullMaxMarks, punctualityBonusHalfMaxMarks
 * and the statutory ones HrSettings already has (PF/ESI/PT, monthDayBasis).
 */
export const PAYROLL_DEFAULTS = Object.freeze({
  marksPerHalfDayLop: 3, // every 3 marks = ½ day LOP
  overtimeMultiplier: 2, // Kerala Shops & Establishments
  punctualityBonusPaise: 50000, // ₹500
  punctualityBonusFullMaxMarks: 2, // 0–2 marks → full
  punctualityBonusHalfMaxMarks: 4, // 3–4 marks → half; 5+ → none
  defaultShiftMinutes: 540, // 10:00–19:00 when the summary gives no shift length
});

const num = (v, fallback, { min = 0, max = Infinity } = {}) => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== '' && Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

export function payrollRules(settings = {}) {
  const ptSlabs = {};
  for (const [state, slabs] of Object.entries(settings.ptSlabs || {})) {
    ptSlabs[state] = [...(slabs || [])]
      .map((s) => ({ fromPaise: Math.round(Number(s.fromPaise) || 0), ptPaise: Math.round(Number(s.ptPaise) || 0) }))
      .sort((a, b) => a.fromPaise - b.fromPaise);
  }
  return {
    monthDayBasis: settings.monthDayBasis === 'fixed_30' ? 'fixed_30' : 'calendar',
    pfEmployeeRate: num(settings.pfEmployeeRate, 0.12, { max: 1 }),
    pfEmployerRate: num(settings.pfEmployerRate, 0.12, { max: 1 }),
    pfWageCeilingPaise: Math.round(num(settings.pfWageCeilingPaise, 1500000)),
    esiEmployeeRate: num(settings.esiEmployeeRate, 0.0075, { max: 1 }),
    esiEmployerRate: num(settings.esiEmployerRate, 0.0325, { max: 1 }),
    esiGrossThresholdPaise: Math.round(num(settings.esiGrossThresholdPaise, 2100000)),
    ptSlabs,
    marksPerHalfDayLop: Math.round(num(settings.marksPerHalfDayLop, PAYROLL_DEFAULTS.marksPerHalfDayLop, { max: 31 })),
    overtimeMultiplier: num(settings.overtimeMultiplier, PAYROLL_DEFAULTS.overtimeMultiplier, { min: 1, max: 3 }),
    punctualityBonusPaise: Math.round(num(settings.punctualityBonusPaise, PAYROLL_DEFAULTS.punctualityBonusPaise)),
    punctualityBonusFullMaxMarks: Math.round(num(settings.punctualityBonusFullMaxMarks, PAYROLL_DEFAULTS.punctualityBonusFullMaxMarks)),
    punctualityBonusHalfMaxMarks: Math.round(num(settings.punctualityBonusHalfMaxMarks, PAYROLL_DEFAULTS.punctualityBonusHalfMaxMarks)),
  };
}
