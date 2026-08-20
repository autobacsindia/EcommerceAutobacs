/**
 * Postal details on the allowlist.
 *
 * These exist because of a real loss: the 2026 festive import read three columns out of
 * a twelve-column operations sheet and silently discarded the rest, addresses included.
 * The list was fine; the importer threw them away and nothing said so. So what is pinned
 * here is that the fields survive the round trip, and — the harder case — that a LATER
 * import from a thinner sheet cannot blank them again.
 */

import { jest } from '@jest/globals';
import Campaign from '../models/Campaign.js';
import CampaignMember from '../models/CampaignMember.js';
import campaignService from '../services/campaignService.js';
import campaignMemberRepository from '../repositories/campaignMemberRepository.js';
import { CAMPAIGN_STATUS, CAMPAIGN_MEMBER_STATUS } from '../config/campaign.js';

jest.setTimeout(60000);

let seq = 0;
let campaign;

const ROW = {
  email: 'Poster@Example.com',
  name: 'Deepak Sewani',
  phone: '+91 9057055500',
  address: '364-A Vardhaman Nagar A, Ajmer Road, near 200Ft Bypass, JAIPUR 302021, Rajasthan',
  pincode: '302021',
  state: 'Rajasthan',
  reviewNote: null,
};

beforeEach(async () => {
  campaign = await Campaign.create({
    slug: `addr-${++seq}-${Date.now()}`, name: 'Address Test',
    status: CAMPAIGN_STATUS.DRAFT, couponCode: `ADDR${seq}`,
  });
});

const only = () => CampaignMember.findOne({ campaign: campaign._id }).lean();

describe('importing postal details', () => {
  test('keeps the address, pincode, state and phone', async () => {
    await campaignService.importMembers(campaign._id, [ROW]);

    const m = await only();
    expect(m.email).toBe('poster@example.com');   // normalised, as before
    expect(m.address).toBe(ROW.address);
    expect(m.pincode).toBe('302021');
    expect(m.state).toBe('Rajasthan');
    expect(m.phone).toBe('+91 9057055500');
  });

  test('an address with commas and landmarks survives intact', async () => {
    // The reason these are free text: a real delivery address carries instructions a
    // courier uses, and splitting it into lines would throw them away.
    const messy = 'Sri Saravana Lodge Proprietor, #2, Perumal Tank South Street Town hall road, near Boopathy Lodge, Madurai 625020, Tamil Nadu';
    await campaignService.importMembers(campaign._id, [{ ...ROW, address: messy }]);
    expect((await only()).address).toBe(messy);
  });

  test('members without postal details still import — they are optional', async () => {
    await campaignService.importMembers(campaign._id, [{ email: 'plain@example.com', name: 'Plain' }]);
    const m = await only();
    expect(m.email).toBe('plain@example.com');
    expect(m.address).toBeNull();
    expect(m.status).toBe(CAMPAIGN_MEMBER_STATUS.INVITED);
  });
});

describe('re-importing must not destroy what is already there', () => {
  test('a sheet with NO address column leaves the stored address alone', async () => {
    await campaignService.importMembers(campaign._id, [ROW]);
    // The exact shape of the original loss, in reverse: a later import from a thinner
    // export must correct the name without blanking the address.
    await campaignService.importMembers(campaign._id, [{ email: ROW.email, name: 'Deepak S' }]);

    const m = await only();
    expect(m.name).toBe('Deepak S');
    expect(m.address).toBe(ROW.address);
    expect(m.pincode).toBe('302021');
    expect(m.phone).toBe('+91 9057055500');
  });

  test('a sheet WITH a new address overwrites the old one', async () => {
    await campaignService.importMembers(campaign._id, [ROW]);
    await campaignService.importMembers(campaign._id, [{ ...ROW, address: 'New house, Jaipur', pincode: '302022' }]);

    const m = await only();
    expect(m.address).toBe('New house, Jaipur');
    expect(m.pincode).toBe('302022');
  });

  test('re-importing never resets a claim or a redemption', async () => {
    await campaignService.importMembers(campaign._id, [ROW]);
    await CampaignMember.updateOne(
      { campaign: campaign._id },
      { $set: { status: CAMPAIGN_MEMBER_STATUS.REDEEMED, discountRupees: 5000 } },
    );

    await campaignService.importMembers(campaign._id, [ROW]);
    const m = await only();
    expect(m.status).toBe(CAMPAIGN_MEMBER_STATUS.REDEEMED);
    expect(m.discountRupees).toBe(5000);
  });
});

describe('the roster returns them', () => {
  test('a page carries the postal fields, so the screen and the export can show them', async () => {
    await campaignService.importMembers(campaign._id, [ROW]);
    const { members } = await campaignMemberRepository.listPage(campaign._id, { limit: 10 });

    expect(members).toHaveLength(1);
    expect(members[0].address).toBe(ROW.address);
    expect(members[0].pincode).toBe('302021');
    expect(members[0].state).toBe('Rajasthan');
    expect(members[0].phone).toBe('+91 9057055500');
  });
});
