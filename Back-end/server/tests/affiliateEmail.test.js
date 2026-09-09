/**
 * Affiliate transactional email — approval and payout.
 *
 * The invariant is once-only under retry. BullMQ retries a failed job, and both of these
 * emails carry money-adjacent information: a duplicate "payout sent" makes an affiliate
 * think they were paid twice. The claim is atomic and taken BEFORE the provider call.
 */

import mongoose from 'mongoose';
import { jest } from '@jest/globals';
import Affiliate from '../models/Affiliate.js';
import AffiliatePayout from '../models/AffiliatePayout.js';
import affiliateRepository from '../repositories/affiliateRepository.js';
import emailHandler from '../services/emailHandler.js';
import {
  emailAffiliateApproved,
  emailAffiliatePayoutSent,
} from '../services/affiliateEmailService.js';
import { AFFILIATE_STATUS, PAYOUT_STATUS } from '../config/affiliate.js';

const oid = () => new mongoose.Types.ObjectId();

let sendSpy;
beforeEach(() => {
  sendSpy = jest.spyOn(emailHandler, 'sendEmail').mockResolvedValue({ success: true });
});
afterEach(() => { jest.restoreAllMocks(); });

const makeAffiliate = (overrides = {}) => Affiliate.create({
  code: 'RAHUL10', name: 'Rahul', email: 'rahul@example.com',
  status: AFFILIATE_STATUS.ACTIVE, commissionPercent: 10, discountPercent: 5,
  ...overrides,
});

describe('emailAffiliateApproved', () => {
  it('sends the code, the link and the terms', async () => {
    const affiliate = await makeAffiliate();

    const res = await emailAffiliateApproved(affiliate._id, { appUrl: 'https://shop.test' });

    expect(res.status).toBe('sent');
    const [{ to, subject, text }] = sendSpy.mock.calls[0];
    expect(to).toBe('rahul@example.com');
    expect(subject).toMatch(/approved/i);
    // The code is the whole point — the sign-up page promises it by email.
    expect(text).toContain('RAHUL10');
    expect(text).toContain('https://shop.test/?ref=RAHUL10');
    expect(text).toContain('10%');
  });

  it('sends exactly once across a retry', async () => {
    const affiliate = await makeAffiliate();

    await emailAffiliateApproved(affiliate._id);
    const second = await emailAffiliateApproved(affiliate._id);

    expect(second.status).toBe('skipped');
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it('sends once under two CONCURRENT workers', async () => {
    const affiliate = await makeAffiliate();

    await Promise.all([
      emailAffiliateApproved(affiliate._id),
      emailAffiliateApproved(affiliate._id),
    ]);

    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  /*
    The claim is taken before the provider call, so a provider failure would otherwise
    leave the email permanently unsendable. Releasing it makes a retry work — a
    permanently missing approval email is worse than a small duplicate risk.
  */
  it('releases the claim when the provider rejects, so a retry can send', async () => {
    const affiliate = await makeAffiliate();
    sendSpy.mockRejectedValueOnce(new Error('Postmark down'));

    await expect(emailAffiliateApproved(affiliate._id)).rejects.toThrow('Postmark down');

    const afterFailure = await affiliateRepository.findById(affiliate._id);
    expect(afterFailure.notifiedEvents).not.toContain('approved');

    expect((await emailAffiliateApproved(affiliate._id)).status).toBe('sent');
  });

  /*
    Approval can be reversed between the enqueue and the worker running. Congratulating
    someone we have just suspended, and handing them a code that no longer discounts, is
    worse than silence.
  */
  it('does not congratulate an affiliate who was suspended before the job ran', async () => {
    const affiliate = await makeAffiliate({ status: AFFILIATE_STATUS.SUSPENDED });

    expect((await emailAffiliateApproved(affiliate._id)).status).toBe('not-active');
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('is a no-op for a missing affiliate', async () => {
    expect((await emailAffiliateApproved(oid())).status).toBe('not-found');
    expect(sendSpy).not.toHaveBeenCalled();
  });
});

describe('emailAffiliatePayoutSent', () => {
  const makePayout = async (affiliate, overrides = {}) => AffiliatePayout.create({
    affiliate: affiliate._id,
    status: PAYOUT_STATUS.PAID,
    grossPaise: 150000,
    tdsPercent: 5,
    tdsPaise: 7500,
    netPaise: 142500,
    commissionCount: 3,
    reference: 'UTR-123',
    bankSnapshot: { accountLast4: '9012' },
    ...overrides,
  });

  /*
    Gross, TDS and net shown separately. An affiliate who sees only the net figure and a
    smaller number in their bank cannot tell a lawful deduction from a mistake.
  */
  it('breaks out gross, TDS and net', async () => {
    const affiliate = await makeAffiliate();
    const payout = await makePayout(affiliate);

    const res = await emailAffiliatePayoutSent(payout._id);

    expect(res.status).toBe('sent');
    const [{ subject, text }] = sendSpy.mock.calls[0];
    expect(subject).toContain('1,425.00');
    expect(text).toContain('1,500.00');   // gross
    expect(text).toContain('75.00');      // TDS
    expect(text).toContain('UTR-123');
    expect(text).toContain('9012');
  });

  it('omits the TDS line entirely when nothing was withheld', async () => {
    const affiliate = await makeAffiliate();
    const payout = await makePayout(affiliate, { tdsPercent: 0, tdsPaise: 0, netPaise: 150000 });

    await emailAffiliatePayoutSent(payout._id);

    expect(sendSpy.mock.calls[0][0].text).not.toMatch(/TDS/);
  });

  /*
    Keyed PER BATCH, not per affiliate — otherwise the second payout to the same person
    would be silently suppressed by the first one's claim.
  */
  it('sends again for a DIFFERENT payout to the same affiliate', async () => {
    const affiliate = await makeAffiliate();
    const first = await makePayout(affiliate);
    const second = await makePayout(affiliate, { reference: 'UTR-456' });

    await emailAffiliatePayoutSent(first._id);
    await emailAffiliatePayoutSent(second._id);

    expect(sendSpy).toHaveBeenCalledTimes(2);
  });

  it('sends once per payout across a retry', async () => {
    const affiliate = await makeAffiliate();
    const payout = await makePayout(affiliate);

    await emailAffiliatePayoutSent(payout._id);
    expect((await emailAffiliatePayoutSent(payout._id)).status).toBe('skipped');
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it('is a no-op for a missing payout', async () => {
    expect((await emailAffiliatePayoutSent(oid())).status).toBe('not-found');
    expect(sendSpy).not.toHaveBeenCalled();
  });
});
