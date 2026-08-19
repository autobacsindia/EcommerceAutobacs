/**
 * Reset campaign invites that were "claimed" by an account that no longer exists.
 *
 * THE PROBLEM
 * -----------
 * A CampaignMember row moves from `invited` to `claimed` when someone signs in with
 * that address and hits the eligibility endpoint. The row stores the account id that
 * did it. If that id points at no user in THIS database, the claim did not come from
 * a real customer of this environment — it is residue from a verification run made
 * against a token minted elsewhere.
 *
 * That residue is not cosmetic. The roster and the funnel report the person as having
 * already engaged, so "who still hasn't claimed?" — the whole point of the list — is
 * wrong, and a genuine customer's record carries activity they never performed.
 *
 * WHAT IT DOES
 *   Finds members with status 'claimed', a non-null `user`, and no matching user
 *   document, then resets them to `invited` (clearing `user` and `claimedAt`).
 *
 * WHAT IT WILL NOT TOUCH
 *   - Anything with status 'redeemed', or with a `redeemedOrder` set. A redemption is
 *     a money event; it is never inferred away by a cleanup script. Those are listed
 *     and skipped so a human decides.
 *   - Claims whose account DOES exist — those are real customers.
 *
 * USAGE
 *   node scripts/reset-campaign-orphan-claims.js                 # dry run (default)
 *   node scripts/reset-campaign-orphan-claims.js --apply
 *   node scripts/reset-campaign-orphan-claims.js --slug=festive-2026 --apply
 *   node scripts/reset-campaign-orphan-claims.js --email=someone@x.com --apply   # named
 *
 * ROLLBACK
 *   The dry run prints the exact prior value of every field it would change, per
 *   document id. Re-applying those restores the previous state exactly.
 *
 * NOTE ON autoIndex
 *   This script imports models, so mongoose.connect MUST pass { autoIndex: false } —
 *   the default is true and would build every declared index against whatever cluster
 *   this points at, which for a local .env in this repo is production.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import CampaignMember from '../models/CampaignMember.js';
import Campaign from '../models/Campaign.js';
import User from '../models/User.js';
import { CAMPAIGN_MEMBER_STATUS } from '../config/campaign.js';

dotenv.config();

const APPLY = process.argv.includes('--apply');
const SLUG = (process.argv.find((a) => a.startsWith('--slug=')) || '').split('=')[1] || null;
/**
 * Targeted reset of a NAMED address, for the other way test residue gets in: a
 * verification run that signed in as a real customer's account. The account exists,
 * so the orphan rule below cannot catch it — only a human knows the claim was not
 * the customer's own, which is exactly why this has to be named explicitly.
 */
const EMAIL = ((process.argv.find((a) => a.startsWith('--email=')) || '').split('=')[1] || '').toLowerCase().trim();

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGO_URI is not set');

  await mongoose.connect(uri, { autoIndex: false });
  console.log(`Connected to ${mongoose.connection.db.databaseName}`);
  console.log(APPLY ? 'MODE: APPLY\n' : 'MODE: DRY RUN (pass --apply to write)\n');

  const filter = { status: CAMPAIGN_MEMBER_STATUS.CLAIMED, user: { $ne: null } };
  if (SLUG) {
    const campaign = await Campaign.findOne({ slug: SLUG }).select('_id').lean();
    if (!campaign) throw new Error(`No campaign with slug "${SLUG}"`);
    filter.campaign = campaign._id;
  }

  if (EMAIL) filter.email = EMAIL;

  const claimed = await CampaignMember.find(filter).lean();
  console.log(`${claimed.length} claimed invite(s) to check.`);
  if (claimed.length === 0) return;

  // One query for every referenced account, rather than one per member.
  const userIds = [...new Set(claimed.map((m) => String(m.user)))];
  const existing = new Set(
    (await User.find({ _id: { $in: userIds } }).select('_id').lean()).map((u) => String(u._id)),
  );

  // With --email the caller has asserted the claim is not the customer's own, so the
  // account-exists test is bypassed for that address and that address only.
  const orphans = EMAIL ? claimed : claimed.filter((m) => !existing.has(String(m.user)));
  const withMoney = orphans.filter((m) => m.redeemedOrder || m.redeemedAt || m.discountRupees > 0);
  const safe = orphans.filter((m) => !m.redeemedOrder && !m.redeemedAt && !m.discountRupees);

  console.log(`  ${claimed.length - orphans.length} claimed by a real account — left alone.`);
  console.log(`  ${orphans.length} to reset${EMAIL ? ` (named explicitly: ${EMAIL})` : ' (account does not exist)'}.\n`);

  if (withMoney.length) {
    console.log('SKIPPED — these carry a redemption, so a human must decide:');
    withMoney.forEach((m) => console.log(`  ${m.email}  order=${m.redeemedOrder}  ₹${m.discountRupees}`));
    console.log('');
  }

  if (safe.length === 0) {
    console.log('Nothing to reset.');
    return;
  }

  console.log(`${APPLY ? 'RESETTING' : 'WOULD RESET'} ${safe.length} invite(s) to "invited":`);
  safe.forEach((m) => {
    console.log(`  ${m.email}`);
    console.log(`    rollback: status="claimed", user="${m.user}", claimedAt=${JSON.stringify(m.claimedAt)}`);
  });

  if (!APPLY) {
    console.log('\nDry run — nothing was written. Re-run with --apply.');
    return;
  }

  // Guarded on the exact state we inspected: if anything claimed or redeemed in the
  // meantime, that document simply does not match and is left untouched.
  const res = await CampaignMember.bulkWrite(
    safe.map((m) => ({
      updateOne: {
        filter: { _id: m._id, status: CAMPAIGN_MEMBER_STATUS.CLAIMED, user: m.user, redeemedOrder: null },
        update: { $set: { status: CAMPAIGN_MEMBER_STATUS.INVITED, user: null, claimedAt: null } },
      },
    })),
    { ordered: false },
  );
  console.log(`\nDone. ${res.modifiedCount} reset, ${safe.length - res.modifiedCount} skipped (state changed).`);
}

main()
  .catch((err) => { console.error('FAILED:', err.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
