/**
 * Affiliate transactional email — approval, and payout sent.
 *
 * Mirrors spinPrizeEmailService: idempotency and data access live here, the provider
 * call lives in emailHandler, and the job is enqueued post-commit so a rolled-back write
 * can never email something that did not happen.
 *
 * ⚠️ THE APPROVAL EMAIL CARRIES THE CODE. Until it is sent, an approved affiliate has no
 * way to learn their own code except by an admin telling them — which is exactly the gap
 * that made the sign-up page's "we will email you your affiliate code" a false promise.
 *
 * Idempotent via `Affiliate.notifiedEvents`, claimed atomically BEFORE the send and
 * released if the provider rejects it. Claiming first is what stops two concurrent
 * workers both sending; releasing on failure is what stops a transient Postmark outage
 * making the email permanently unsendable.
 */

import affiliateRepository from '../repositories/affiliateRepository.js';
import affiliatePayoutRepository from '../repositories/affiliatePayoutRepository.js';
import emailHandler from './emailHandler.js';
import { affiliateApprovedEmail, affiliatePayoutSentEmail } from '../utils/emailTemplates.js';
import { AFFILIATE_STATUS } from '../config/affiliate.js';
import { fromPaise } from '../utils/money.js';

const APPROVED_KEY = 'approved';
const payoutKey = (payoutId) => `payout:${payoutId}`;

/**
 * Send one email under a once-only claim.
 * @returns {Promise<{status: 'sent'|'skipped'|'not-found'|'not-active'|'no-recipient'}>}
 */
const sendOnce = async (affiliateId, key, build) => {
  const affiliate = await affiliateRepository.findById(affiliateId);
  if (!affiliate) return { status: 'not-found' };
  if (!affiliate.email) return { status: 'no-recipient' };

  const payload = await build(affiliate);
  if (payload?.skip) return { status: payload.skip };

  // Claim BEFORE any provider work, so two concurrent workers cannot both send.
  if (!(await affiliateRepository.claimNotification(affiliateId, key))) {
    return { status: 'skipped' };
  }

  try {
    const { subject, text, html } = payload.template;
    await emailHandler.sendEmail({ to: affiliate.email, subject, text, html });
    return { status: 'sent' };
  } catch (err) {
    // Give the key back so a retry can send. A permanently unsent email is worse than
    // the small risk of a duplicate after a provider timeout that actually delivered.
    await affiliateRepository.releaseNotification(affiliateId, key).catch(() => {});
    throw err;
  }
};

/** "You're approved — here is your code and link." */
export const emailAffiliateApproved = (affiliateId, { appUrl } = {}) =>
  sendOnce(affiliateId, APPROVED_KEY, (affiliate) => {
    // Approval can be reversed before the worker runs; do not congratulate someone we
    // have just suspended.
    if (affiliate.status !== AFFILIATE_STATUS.ACTIVE) return { skip: 'not-active' };
    if (!affiliate.code) return { skip: 'not-active' };

    const base = appUrl || process.env.FRONTEND_URL || 'https://autobacsindia.com';
    return {
      template: affiliateApprovedEmail({
        name: affiliate.name,
        code: affiliate.code,
        link: `${base}/?ref=${affiliate.code}`,
        dashboardUrl: `${base}/account/affiliate`,
        commissionPercent: affiliate.commissionPercent,
        discountPercent: affiliate.discountPercent,
        firstOrderOnly: affiliate.firstOrderOnly,
      }),
    };
  });

/** "We've sent your payout." Keyed per batch, so each payout mails exactly once. */
export const emailAffiliatePayoutSent = async (payoutId) => {
  const payout = await affiliatePayoutRepository.findById(payoutId);
  if (!payout) return { status: 'not-found' };

  return sendOnce(payout.affiliate, payoutKey(payoutId), (affiliate) => ({
    template: affiliatePayoutSentEmail({
      name: affiliate.name,
      grossRupees: fromPaise(payout.grossPaise),
      tdsRupees: fromPaise(payout.tdsPaise),
      tdsPercent: payout.tdsPercent,
      netRupees: fromPaise(payout.netPaise),
      reference: payout.reference,
      accountLast4: payout.bankSnapshot?.accountLast4,
      commissionCount: payout.commissionCount,
    }),
  }));
};

export default { emailAffiliateApproved, emailAffiliatePayoutSent };
