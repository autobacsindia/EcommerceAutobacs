/**
 * Salary payouts: ONE PaymentRequest per payslip of an approved run, raised into
 * the existing approve → pay flow (models/PaymentRequest.js: accounts approves,
 * the admin pays and records it). ADR §1 Payouts: kind 'expense', category
 * 'salary', team 'hr'; the description carries the month and payslip number
 * only, never the breakdown.
 *
 * Idempotent per payslip (key = run + employee, since a run has one monthly
 * payslip per employee): in ONE transaction the payslip is claimed with a
 * compare-and-set `{ payoutRequest: null } → id` and the request is created with
 * that id. A second call — the same admin clicking twice, two admins at once, a
 * retry after a crash — either sees the link and skips, or loses the CAS and its
 * transaction (with its request) rolls back. So approve twice → one request each.
 *
 * A payslip with net ₹0 raises nothing.
 */
import mongoose from 'mongoose';
import payrollRepository from '../../../repositories/hr/payrollRepository.js';
import paymentRequestRepository from '../../../repositories/paymentRequestRepository.js';
import counterRepository from '../../../repositories/counterRepository.js';
import { decryptField } from '../../../utils/fieldEncryption.js';
import { ACCOUNT, IFSC, UPI } from '../../../utils/payee.js';
import { fromPaise } from '../../../utils/money.js';
import { recordHrAudit } from '../audit.js';
import { withTx } from './tx.js';
import { mapLimit } from './concurrency.js';

export const SALARY_CATEGORY = 'salary';
export const SALARY_TEAM = 'hr';
export const payslipNumber = (p) => `PS-${p.month}-${p.snapshot?.employeeCode || String(p.employee).slice(-6)}`;
export const payoutClientId = (p) => `payroll:${p.run}:${p.employee}`;

const nextNumber = async () => `PR-${String(await counterRepository.next('payment_request')).padStart(4, '0')}`;

const safeDecrypt = (v) => {
  if (!v) return '';
  try { return String(decryptField(v) || ''); } catch { return ''; }
};

/** Where to pay: the bank account / UPI on the HR profile, when valid. Else blank (accounts fills it in). */
function payeeOf(e, fallbackName) {
  const name = String(e?.bank?.holderName || e?.name || fallbackName || '').slice(0, 120);
  const account = safeDecrypt(e?.bank?.accountEnc);
  const ifsc = String(e?.bank?.ifsc || '').toUpperCase();
  if (ACCOUNT.test(account) && IFSC.test(ifsc)) {
    return { name, method: 'bank', accountName: name, accountNumber: account, ifsc };
  }
  const upi = safeDecrypt(e?.bank?.upiEnc);
  if (UPI.test(upi)) return { name, method: 'upi', upiId: upi };
  return { name, method: '' };
}

// Payouts run a few at a time. Each one is its own transaction with its own CAS
// claim on the payslip, so they are independent: running them side by side
// changes speed, not the outcome (measured: 200 payslips 8.9 s one by one).
const PAYOUT_CONCURRENCY = 5;

export async function createPayouts(actor, month, { req = null } = {}) {
  const run = await payrollRepository.findRun(month);
  if (!run || run.status !== 'approved') return { created: 0, existing: 0, skippedZero: 0 };
  const slips = await payrollRepository.listRunPayslips(run._id);
  let created = 0;
  let existing = slips.filter((s) => s.payoutRequest).length;
  const todo = slips.filter((s) => !s.payoutRequest && s.netPaise > 0);
  const skippedZero = slips.filter((s) => !s.payoutRequest && !(s.netPaise > 0)).length;
  // One read for every payee instead of one per payslip.
  const people = new Map((await payrollRepository.employeePayees(todo.map((s) => s.employee))).map((e) => [String(e._id), e]));
  await mapLimit(todo, PAYOUT_CONCURRENCY, async (s) => {
    const payee = payeeOf(people.get(String(s.employee)), s.snapshot?.name);
    const number = await nextNumber();
    const ok = await withTx(async (session) => {
      const id = new mongoose.Types.ObjectId();
      const claimed = await payrollRepository.claimPayout(s._id, id, session);
      if (!claimed) return false; // someone else raised it
      await paymentRequestRepository.create({
        _id: id,
        number,
        kind: 'expense',
        status: 'submitted',
        team: SALARY_TEAM,
        requestedBy: actor._id,
        requestedByName: actor.name || actor.email || 'Admin',
        amount: fromPaise(s.netPaise),
        currency: 'INR',
        category: SALARY_CATEGORY,
        description: `Salary ${month} — payslip ${payslipNumber(s)}`,
        reference: payslipNumber(s).slice(0, 60),
        payee,
        clientId: payoutClientId(s),
        history: [{ at: new Date(), by: actor._id, byName: actor.name || '', role: 'admin', action: 'submitted', note: `Payroll ${month} approved` }],
      }, session);
      await recordHrAudit({
        action: 'payroll.payout_raised', entity: 'Payslip', entityId: s._id, subject: s.employee, actor, req, session,
        changes: [{ field: 'payoutRequest', from: null, to: number }],
      });
      return true;
    }).catch((err) => {
      // The unique client-id index caught a parallel raiser: same outcome as a lost claim.
      if (err?.code === 11000) return false;
      throw err;
    });
    if (ok) created += 1; else existing += 1;
  });
  const total = await payrollRepository.countPayouts(run._id);
  if (created > 0) {
    await payrollRepository.pushRunHistory(run._id, { payoutsCreatedAt: new Date(), payoutsCount: total }, {
      action: 'payouts_created', at: new Date(), by: actor._id, byName: actor.name || 'admin', reason: `${created} payment request(s)`,
    });
  }
  return { created, existing, skippedZero, total };
}
