/**
 * "Your payslip is ready" phone push, after a run is approved (released).
 *
 * The sender lives in services/hr/notify (built by the app-complete session on
 * its own branch): notifyPayslipReady({ employeeId, month, payslipId }) never
 * throws and is idempotent on the payslip id. It is loaded lazily so payroll
 * works (and skips the push) before that module is merged; once both are in,
 * nothing here changes. A push failure never affects payroll.
 */
let loadNotify = () => import('../notify/index.js');
/** Tests swap the loader. */
export const setNotifyLoader = (fn) => { loadNotify = fn; };

export async function notifyPayslipsReleased(slips) {
  let mod;
  try {
    mod = await loadNotify();
  } catch {
    return { sent: 0, skipped: 'notify module not installed' };
  }
  if (typeof mod?.notifyPayslipReady !== 'function') return { sent: 0, skipped: 'notifyPayslipReady missing' };
  let sent = 0;
  for (const s of slips) {
    try {
      await mod.notifyPayslipReady({ employeeId: String(s.employee), month: s.month, payslipId: String(s._id) });
      sent += 1;
    } catch { /* never throws by contract; a push must not break payroll */ }
  }
  return { sent };
}
