/**
 * Affiliate payouts — batching approved commissions into a bank transfer we make by hand.
 *
 * ── WE DO NOT SEND MONEY ─────────────────────────────────────────────────────────
 * There is no RazorpayX integration, no fund account, no KYC flow. An admin builds a
 * batch, transfers the net from their own bank, and records the UTR. The precedent is
 * the offline return refund (models/ReturnRequest.js), which is likewise "a RECORD of a
 * payout that already happened".
 *
 * ── THE CLAIM IS IN THE ROWS, NOT THE PAYOUT ─────────────────────────────────────
 * The commission rows are the money, so they carry the guard: a batch is built by
 * flipping `{affiliate, status:'approved', payout:null}` → `{status:'paid', payout:id}`
 * in ONE transaction. A second admin's identical updateMany matches zero rows and the
 * call 409s, so two payout documents with money on them cannot both exist. Same shape
 * as couponUserUsageRepository's guarded upsert: counting is not atomic, a guarded
 * write is.
 *
 * The totals are then summed FROM THE ROWS ACTUALLY CLAIMED. Reading a balance first
 * and trusting it afterwards is a TOCTOU window in which a concurrent clawback would
 * make the payout overstate what it paid.
 */

import mongoose from 'mongoose';
import affiliateRepository from '../repositories/affiliateRepository.js';
import affiliatePayoutRepository from '../repositories/affiliatePayoutRepository.js';
import affiliateCommissionRepository from '../repositories/affiliateCommissionRepository.js';
import AppError from '../utils/AppError.js';
import { enqueueNotification } from '../queue/queues.js';
import { toPaise, fromPaise } from '../utils/money.js';
import {
  AFFILIATE_STATUS,
  MIN_PAYOUT_RUPEES,
  PAYOUT_STATUS,
  isAffiliateEnabled,
} from '../config/affiliate.js';

class AffiliatePayoutService {
  /**
   * Claim everything payable for one affiliate into a new payout.
   *
   * @throws {AppError} 409 when another admin already claimed these rows
   * @throws {AppError} 400 when the balance is below the floor, or negative
   */
  async buildBatch(affiliateId, { adminId = null } = {}) {
    if (!isAffiliateEnabled()) {
      throw new AppError('The affiliate programme is not enabled.', 400);
    }

    const affiliate = await affiliateRepository.findForPayout(affiliateId);
    if (!affiliate) throw new AppError('Affiliate not found', 404);

    /*
      ⚠️ A SUSPENDED AFFILIATE IS NOT PAID BY REFLEX.

      Suspension does not void commission already earned — the work was done, and voiding
      it is a separate, deliberate admin action. So a suspended affiliate can legitimately
      still be owed money, and this is NOT a claim that they are not.

      But `requestPayout` already refuses them, and the payout queue excludes them; if
      this path did not, the two halves of the same feature would disagree and the
      difference would be a real bank transfer to someone suspended for fraud. Filtering
      the queue is not enough on its own — this endpoint is directly callable.

      Paying them out anyway is a decision, not an accident: reinstate, pay, suspend
      again. That leaves an audit trail of someone choosing it.
    */
    if (affiliate.status !== AFFILIATE_STATUS.ACTIVE) {
      throw new AppError(
        `This affiliate is ${affiliate.status}, so a payout cannot be built. `
        + 'Reinstate them to pay what they earned, or void the commissions deliberately.',
        400,
        { expose: true },
      );
    }

    /*
      A read BEFORE the claim, used only to fail fast with a helpful message. It is NOT
      the authority — the totals below come from the rows actually claimed, because
      between this read and that write a clawback could land.
    */
    const preview = await affiliateCommissionRepository.payableBalancePaise(affiliateId);
    if (preview < 0) {
      throw new AppError(
        `This affiliate currently owes ₹${fromPaise(-preview)} back from refunded orders. `
        + 'That debt has to be cleared by future earnings before a payout can be made.',
        400,
        { expose: true },
      );
    }
    if (preview < toPaise(MIN_PAYOUT_RUPEES)) {
      throw new AppError(
        `Balance is ₹${fromPaise(preview)}, below the ₹${MIN_PAYOUT_RUPEES} minimum payout.`,
        400,
        { expose: true },
      );
    }

    const session = await mongoose.startSession();
    try {
      let payoutId;
      await session.withTransaction(async () => {
        const payout = await affiliatePayoutRepository.createInSession(
          {
            affiliate: affiliate._id,
            status: PAYOUT_STATUS.DRAFT,
            grossPaise: 0,
            netPaise: 0,
            tdsPercent: affiliate.tdsPercent || 0,
            /*
              Snapshotted, because an affiliate can change bank account and a payout must
              always show where the money actually went. Never the full account number or
              the PAN: `accountLast4` is enough to match a bank-statement line, and
              copying financial PII into a second, longer-lived collection would be a
              real cost for no benefit.
            */
            bankSnapshot: {
              accountHolderName: affiliate.payoutDetails?.accountHolderName,
              accountLast4: affiliate.payoutDetails?.accountLast4,
              ifsc: affiliate.payoutDetails?.ifsc,
              upiId: affiliate.payoutDetails?.upiId,
            },
          },
          session,
        );

        // ── THE CLAIM ──────────────────────────────────────────────────────────
        const claimed = await affiliateCommissionRepository.claimForPayout(
          affiliate._id,
          payout._id,
          session,
        );

        if (claimed === 0) {
          // Another admin got there first. Aborting rolls the empty payout back, so no
          // second document with money on it can survive.
          throw new AppError(
            'Nothing left to pay — another admin has just built a batch for this affiliate. '
            + 'Refresh to see it.',
            409,
            { expose: true },
          );
        }

        // ── Totals, from the rows we ACTUALLY claimed ──────────────────────────
        const totals = await affiliateCommissionRepository.payoutTotals(payout._id, session);
        const grossPaise = totals.grossPaise;

        /*
          A concurrent clawback can land between the preview and the claim and drag the
          claimed total below the floor — or negative. Re-checking here, inside the
          transaction, means we abort and release the rows rather than recording a
          payout for an amount nobody should send.
        */
        if (grossPaise < toPaise(MIN_PAYOUT_RUPEES)) {
          throw new AppError(
            `Balance changed while building the batch — it is now ₹${fromPaise(grossPaise)}, `
            + `below the ₹${MIN_PAYOUT_RUPEES} minimum. Nothing has been claimed.`,
            409,
            { expose: true },
          );
        }

        // TDS is a RECORDED deduction, never a derived one — see Affiliate.tdsPercent.
        // Floored, so we never withhold a paise more than the rate states.
        const tdsPaise = Math.floor((grossPaise * (affiliate.tdsPercent || 0)) / 100);

        payout.grossPaise = grossPaise;
        payout.tdsPaise = tdsPaise;
        payout.netPaise = grossPaise - tdsPaise;
        payout.commissionCount = totals.count;
        payout.periodFrom = totals.from;
        payout.periodTo = totals.to;
        payout.paidBy = adminId;
        await affiliatePayoutRepository.saveInSession(payout, session);

        /*
          The affiliate's "please pay me" signal is answered — clear it in the SAME
          transaction that claims the rows.

          Leaving it set would keep them at the top of the admin queue after the money
          had already been batched, which is how the same person gets paid twice by a
          second admin who trusts the queue. Clearing it outside the transaction would
          open the same window on any failure between the two writes.
        */
        await affiliateRepository.clearPayoutRequest(affiliate._id, session);

        payoutId = payout._id;
      });

      return affiliatePayoutRepository.findByIdPopulated(payoutId);
    } finally {
      await session.endSession();
    }
  }

  /**
   * Record that the transfer landed.
   *
   * Guarded on the states this transition is legal from, so two admins racing on "mark
   * paid" cannot both record a transfer and a stale tab cannot revive a failed payout.
   * The unique index on `reference` is the second guard: the same UTR can never be
   * recorded against two payouts, which is what catches a pasted-twice reference.
   */
  async markPaid(payoutId, { reference, method, notes, adminId } = {}) {
    if (!reference) throw new AppError('A bank reference (UTR) is required', 400);

    try {
      const moved = await affiliatePayoutRepository.transitionOnce(
        payoutId,
        [PAYOUT_STATUS.DRAFT, PAYOUT_STATUS.PROCESSING],
        {
          status: PAYOUT_STATUS.PAID,
          reference: String(reference).trim(),
          ...(method && { method }),
          ...(notes !== undefined && { notes }),
          paidAt: new Date(),
          paidBy: adminId || null,
        },
      );
      if (!moved) {
        throw new AppError(
          'This payout has already been resolved. Refresh to see its current state.',
          409,
          { expose: true },
        );
      }
    } catch (err) {
      if (err?.code === 11000) {
        throw new AppError(
          'That bank reference is already recorded against another payout.',
          409,
          { expose: true },
        );
      }
      throw err;
    }

    // Post-commit and fire-and-forget: the transfer is recorded either way, and the
    // worker's per-batch claim (`payout:<id>`) makes a duplicate enqueue harmless.
    enqueueNotification('send-affiliate-payout', { payoutId: String(payoutId) });

    return affiliatePayoutRepository.findById(payoutId);
  }

  /**
   * The transfer did not happen. RELEASES the claim.
   *
   * Rows go back to `approved` / `payout: null`, i.e. straight back into the payable
   * pool where the next batch will pick them up. There is deliberately no partial state:
   * a manual NEFT is one instruction, and apportioning a partial bank event across rows
   * would need information a statement does not give us.
   */
  async markFailed(payoutId, { failureReason } = {}) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const moved = await affiliatePayoutRepository.transitionOnce(
          payoutId,
          [PAYOUT_STATUS.DRAFT, PAYOUT_STATUS.PROCESSING],
          {
            status: PAYOUT_STATUS.FAILED,
            ...(failureReason !== undefined && { failureReason }),
          },
          session,
        );
        if (!moved) {
          throw new AppError(
            'This payout has already been resolved. Refresh to see its current state.',
            409,
            { expose: true },
          );
        }

        // Release, in the SAME transaction as the status flip — otherwise a crash
        // between them strands the rows against a failed payout, invisible in both the
        // payable balance and the batch.
        await affiliateCommissionRepository.releaseFromPayout(payoutId, session);
      });
    } finally {
      await session.endSession();
    }

    return affiliatePayoutRepository.findById(payoutId);
  }

  /** Admin list — cursor-paginated, bounded. */
  async listAdmin({ limit = 50, before = null, status = null, affiliate = null } = {}) {
    const capped = Math.min(Math.max(1, Number(limit) || 50), 100);
    const rows = await affiliatePayoutRepository.findPage({
      limit: capped + 1,
      before,
      status,
      affiliate,
    });
    const hasMore = rows.length > capped;
    const payouts = hasMore ? rows.slice(0, capped) : rows;
    return { payouts, nextCursor: hasMore ? payouts.at(-1).createdAt : null };
  }

  /**
   * A Form-26Q-ready CSV of paid payouts.
   *
   * ⚠️ A REPORT, NOT A FILING. It exports the numbers that were recorded — it does not
   * decide which section applies, what the rate should be, or whether a threshold has
   * been crossed. Those are the accountant's determinations (see Affiliate.tdsPercent).
   *
   * Deliberately reads PAN from the Affiliate rather than the payout snapshot: the
   * snapshot never stores it, precisely so financial PII is not duplicated.
   */
  async exportTdsCsv({ from = null, to = null } = {}) {
    const payouts = await affiliatePayoutRepository.findPaidBetween(from, to, PAYOUT_STATUS.PAID);

    // One extra read per payout is acceptable for an on-demand finance export; it is not
    // on any request path. Optimise only if a measurement says to.
    const rows = [];
    for (const p of payouts) {
      // The one place a PAN is legitimately read in the clear — a TDS filing needs it.
      const secrets = await affiliateRepository.readPayoutSecrets(p.affiliate);
      const affiliate = await affiliateRepository.findById(p.affiliate);
      rows.push([
        secrets?.panNumber || '',
        affiliate?.name || '',
        fromPaise(p.grossPaise).toFixed(2),
        (p.tdsPercent || 0).toFixed(2),
        fromPaise(p.tdsPaise).toFixed(2),
        fromPaise(p.netPaise).toFixed(2),
        p.paidAt ? new Date(p.paidAt).toISOString().slice(0, 10) : '',
        p.reference || '',
      ]);
    }

    /*
      Quote for CSV, and NEUTRALISE spreadsheet formulas.

      `affiliate.name` comes straight from the unauthenticated application form, and this
      file is opened in Excel/Sheets by someone in finance — next to a column of PANs. A
      name beginning `=`, `+`, `-`, `@` (or a tab/CR, which Excel also treats as a formula
      lead-in) is evaluated on open, and `=HYPERLINK(...)`/`=WEBSERVICE(...)` will happily
      exfiltrate the row it sits in. Quoting alone does NOT stop this: Excel strips the
      quotes first, then parses.

      Prefixing an apostrophe is the standard neutralisation — it forces the cell to text
      and is invisible in the rendered sheet.
    */
    const escape = (v) => {
      const raw = String(v ?? '');
      const neutralised = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
      return `"${neutralised.replace(/"/g, '""')}"`;
    };
    const header = ['PAN', 'Name', 'Gross', 'TDS %', 'TDS', 'Net', 'Paid on', 'Reference'];
    return [header, ...rows].map((r) => r.map(escape).join(',')).join('\n');
  }
}

export default new AffiliatePayoutService();
