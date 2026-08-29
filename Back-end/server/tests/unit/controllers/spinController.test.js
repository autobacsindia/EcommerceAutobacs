/**
 * Spin controller — authorisation boundary.
 *
 * The service suite (tests/spinService.test.js) proves the draw is correct. This proves
 * the thing the service cannot: that a spin can only be triggered by the person whose
 * order it is. Order ids are enumerable ObjectIds, so "is logged in" is not authorisation
 * — without an ownership check any account could spin, and consume the stock of, every
 * other customer's order.
 *
 * Deliberately a unit test with mocked collaborators: the property under test is a
 * branch in the controller, and booting a replica set to assert it would add ~10s for
 * no extra coverage.
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';

const ORDER_ID = new mongoose.Types.ObjectId();
const OWNER_ID = new mongoose.Types.ObjectId();
const ATTACKER_ID = new mongoose.Types.ObjectId();

const mockOrder = { findForSpinEligibility: jest.fn() };
const mockSpinService = {
  spin: jest.fn(),
  checkEligibility: jest.fn(),
  buildSegments: jest.fn(() => ({ slices: [], segmentIndex: 0, labels: [] })),
};


jest.unstable_mockModule('../../../services/spinService.js', () => ({
  default: mockSpinService,
  INELIGIBLE: { NOT_PAID: 'not_paid' },
}));
jest.unstable_mockModule('../../../repositories/orderRepository.js', () => ({
  default: { findForSpinEligibility: mockOrder.findForSpinEligibility, markSpinRewardFulfilled: jest.fn() },
}));
// NOTE: mocked at the REPOSITORY layer, not the model layer — direct model imports are
// forbidden outside repositories/ (eslint no-restricted-imports), so that is the seam the
// controller actually depends on.
const mockCampaignRepo = {
  findById: jest.fn().mockResolvedValue(null),
  findLeanById: jest.fn(),
  createCampaign: jest.fn(),
  updateById: jest.fn(),
};
jest.unstable_mockModule('../../../services/auditLogger.js', () => ({
  default: { logAction: jest.fn() },
}));
jest.unstable_mockModule('../../../services/cacheService.js', () => ({
  default: { invalidatePattern: jest.fn() },
}));
jest.unstable_mockModule('../../../repositories/spinCampaignRepository.js', () => ({
  default: mockCampaignRepo,
}));
const mockPrizeRepo = {
  findEligiblePool: jest.fn().mockResolvedValue([]),
  findByCampaign: jest.fn().mockResolvedValue([]),
  createMany: jest.fn(),
  findDocById: jest.fn(),
  updateById: jest.fn(),
  countFloorPrizes: jest.fn().mockResolvedValue(0),
};
jest.unstable_mockModule('../../../repositories/spinPrizeRepository.js', () => ({
  default: mockPrizeRepo,
}));
const mockResultRepo = {
  findFulfilmentQueue: jest.fn(),
  countUnfulfilled: jest.fn(),
  countGrantedForCampaign: jest.fn().mockResolvedValue(0),
};
jest.unstable_mockModule('../../../repositories/spinResultRepository.js', () => ({
  default: mockResultRepo,
}));

let controller;

/** orderRepository.findForSpinEligibility resolves the doc directly — no query chain to fake. */
const orderReturning = (doc) => doc;

const res = () => {
  const r = {};
  r.status = jest.fn(() => r);
  r.json = jest.fn(() => r);
  return r;
};

beforeAll(async () => {
  controller = await import('../../../controllers/spinController.js');
});

beforeEach(() => {
  mockOrder.findForSpinEligibility.mockReset();
  mockSpinService.spin.mockReset();
});

describe('ownership boundary', () => {
  it('refuses to spin an order belonging to a DIFFERENT user', async () => {
    mockOrder.findForSpinEligibility.mockResolvedValue(orderReturning({ _id: ORDER_ID, user: OWNER_ID }));

    const req = { params: { orderId: String(ORDER_ID) }, user: { _id: ATTACKER_ID }, headers: {} };

    await expect(controller.postSpin(req, res())).rejects.toMatchObject({ statusCode: 404 });
    // The decisive assertion: the draw was never reached, so no stock moved.
    expect(mockSpinService.spin).not.toHaveBeenCalled();
  });

  it('answers 404 (not 403) so order ids cannot be probed for existence', async () => {
    mockOrder.findForSpinEligibility.mockResolvedValue(orderReturning({ _id: ORDER_ID, user: OWNER_ID }));
    const req = { params: { orderId: String(ORDER_ID) }, user: { _id: ATTACKER_ID }, headers: {} };

    // A 403 would confirm "this order exists but is not yours" to an attacker
    // enumerating ids; 404 is indistinguishable from a nonexistent order.
    await expect(controller.postSpin(req, res())).rejects.toMatchObject({ statusCode: 404 });
  });

  it('lets the OWNER spin their own order', async () => {
    mockOrder.findForSpinEligibility.mockResolvedValue(orderReturning({ _id: ORDER_ID, user: OWNER_ID }));
    mockSpinService.spin.mockResolvedValue({
      alreadySpun: false,
      result: {
        campaign: new mongoose.Types.ObjectId(),
        prizeSnapshot: { name: 'Cloth', kind: 'goodie' },
        segmentIndex: 2, segmentLabels: ['a'], status: 'granted', spunAt: new Date(),
      },
    });

    const req = { params: { orderId: String(ORDER_ID) }, user: { _id: OWNER_ID }, headers: {} };
    const r = res();
    await controller.postSpin(req, r);

    expect(mockSpinService.spin).toHaveBeenCalledTimes(1);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('rejects a malformed order id without touching the database', async () => {
    const req = { params: { orderId: 'not-an-objectid' }, user: { _id: OWNER_ID }, headers: {} };
    await expect(controller.postSpin(req, res())).rejects.toMatchObject({ statusCode: 404 });
    expect(mockOrder.findForSpinEligibility).not.toHaveBeenCalled();
  });

  it('refuses a guest order with no owner rather than defaulting to allow', async () => {
    // A null user must not compare equal to anything — fail closed.
    mockOrder.findForSpinEligibility.mockResolvedValue(orderReturning({ _id: ORDER_ID, user: null }));
    const req = { params: { orderId: String(ORDER_ID) }, user: { _id: OWNER_ID }, headers: {} };
    await expect(controller.postSpin(req, res())).rejects.toMatchObject({ statusCode: 404 });
    expect(mockSpinService.spin).not.toHaveBeenCalled();
  });

  it('allows an admin to act on any order', async () => {
    mockOrder.findForSpinEligibility.mockResolvedValue(orderReturning({ _id: ORDER_ID, user: OWNER_ID }));
    mockSpinService.spin.mockResolvedValue({
      alreadySpun: true,
      result: {
        campaign: new mongoose.Types.ObjectId(),
        prizeSnapshot: { name: 'Cloth', kind: 'goodie' },
        segmentIndex: 0, segmentLabels: [], status: 'granted', spunAt: new Date(),
      },
    });
    const req = {
      params: { orderId: String(ORDER_ID) },
      user: { _id: ATTACKER_ID, role: 'admin' },
      headers: {},
    };
    await controller.postSpin(req, res());
    expect(mockSpinService.spin).toHaveBeenCalledTimes(1);
  });
});

describe('client IP for rate limiting and forensics', () => {
  it('prefers cf-connecting-ip over req.ip', async () => {
    mockOrder.findForSpinEligibility.mockResolvedValue(orderReturning({ _id: ORDER_ID, user: OWNER_ID }));
    mockSpinService.spin.mockResolvedValue({
      alreadySpun: false,
      result: {
        campaign: new mongoose.Types.ObjectId(),
        prizeSnapshot: { name: 'X', kind: 'goodie' },
        segmentIndex: 0, segmentLabels: [], status: 'granted', spunAt: new Date(),
      },
    });

    const req = {
      params: { orderId: String(ORDER_ID) },
      user: { _id: OWNER_ID },
      // Behind Cloudflare req.ip is the EDGE address — using it would bucket every
      // customer in the country together and make the limiter inert.
      headers: { 'cf-connecting-ip': '203.0.113.9' },
      ip: '172.16.0.1',
    };
    await controller.postSpin(req, res());

    expect(mockSpinService.spin).toHaveBeenCalledWith(
      String(ORDER_ID),
      expect.objectContaining({ ip: '203.0.113.9' }),
    );
  });
});


describe('cloning a campaign to open a new window', () => {
  const SOURCE_ID = new mongoose.Types.ObjectId();
  const CLONE_ID = new mongoose.Types.ObjectId();

  beforeEach(() => {
    mockCampaignRepo.findLeanById.mockReset();
    mockCampaignRepo.createCampaign.mockReset();
    mockPrizeRepo.createMany.mockReset();
    mockPrizeRepo.findByCampaign.mockReset();
  });

  const seedSource = () => {
    mockCampaignRepo.findLeanById.mockResolvedValue({
      _id: SOURCE_ID,
      slug: 'diwali-2026',
      name: 'Diwali 2026',
      status: 'live',
      startsAt: new Date('2026-11-05'),
      endsAt: new Date('2026-11-15'),
      goodieWinRatePercent: 20,
      maxSpinsPerUserPerCampaign: 1,
      createdAt: new Date(), updatedAt: new Date(), __v: 0,
    });
    mockCampaignRepo.createCampaign.mockImplementation(async (doc) => ({ ...doc, _id: CLONE_ID }));
  };

  it('produces a NEW campaign id, which is what resets the per-user cap', async () => {
    seedSource();
    mockPrizeRepo.findByCampaign.mockResolvedValue([]);

    const r = res();
    await controller.cloneCampaign(
      { params: { id: String(SOURCE_ID) }, body: { slug: 'diwali-2027' }, user: { _id: OWNER_ID } },
      r,
    );

    // A different _id is the entire point: the cap counts spins scoped to campaign id,
    // so last window's capped customers can play again.
    expect(String(CLONE_ID)).not.toBe(String(SOURCE_ID));
    expect(r.status).toHaveBeenCalledWith(201);
  });

  it('lands in DRAFT so a copy can never start awarding prizes on creation', async () => {
    seedSource();
    mockPrizeRepo.findByCampaign.mockResolvedValue([]);

    await controller.cloneCampaign(
      { params: { id: String(SOURCE_ID) }, body: { slug: 'diwali-2027' }, user: { _id: OWNER_ID } },
      res(),
    );

    expect(mockCampaignRepo.createCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'draft', slug: 'diwali-2027' }),
    );
  });

  it('RESTOCKS prizes and clears awarded + daily-cap accounting', async () => {
    seedSource();
    mockPrizeRepo.findByCampaign.mockResolvedValue([{
      _id: new mongoose.Types.ObjectId(),
      campaign: SOURCE_ID,
      name: 'Dashcam', sku: 'D1', kind: 'goodie',
      stockTotal: 10,
      stockRemaining: 2,      // last window nearly drained it
      stockAwarded: 8,
      capDate: '2026-11-14',  // stale cap state
      capCount: 3,
      maxWinsPerDay: 3,
      createdAt: new Date(), updatedAt: new Date(), __v: 0,
    }]);

    await controller.cloneCampaign(
      { params: { id: String(SOURCE_ID) }, body: { slug: 'diwali-2027' }, user: { _id: OWNER_ID } },
      res(),
    );

    const [cloned] = mockPrizeRepo.createMany.mock.calls[0][0];
    expect(cloned.campaign).toBe(CLONE_ID);
    // A new window starts from the shelf you have, not last window's leftovers.
    expect(cloned.stockRemaining).toBe(10);
    expect(cloned.stockAwarded).toBe(0);
    // A stale capDate would let last window's daily cap suppress this window's day one.
    expect(cloned.capDate).toBeNull();
    expect(cloned.capCount).toBe(0);
    // Settings that should survive the copy.
    expect(cloned.maxWinsPerDay).toBe(3);
    expect(cloned.name).toBe('Dashcam');
  });

  it('404s on an unknown source campaign', async () => {
    mockCampaignRepo.findLeanById.mockResolvedValue(null);
    await expect(controller.cloneCampaign(
      { params: { id: String(SOURCE_ID) }, body: { slug: 'x' }, user: { _id: OWNER_ID } },
      res(),
    )).rejects.toMatchObject({ statusCode: 404 });
  });
});

/**
 * Editing a prize AFTER the campaign is live.
 *
 * The publish gate is a one-time check — it runs when the campaign is published and
 * never again. Every edit after that goes straight to the draw with nothing in between
 * it and a paying customer, so the invariants the gate protects have to be re-enforced
 * on the update path. The failure these prevent is quiet and total: strip the guaranteed
 * prize from a live campaign and checkEligibility starts returning `misconfigured`, so
 * the wheel simply stops appearing for everyone and nothing says why.
 */
describe('editing a prize on a LIVE campaign', () => {
  const PRIZE_ID = new mongoose.Types.ObjectId();
  const CAMPAIGN_ID = new mongoose.Types.ObjectId();

  const existingPrize = (over = {}) => ({
    _id: PRIZE_ID, campaign: CAMPAIGN_ID, name: 'Coupon', kind: 'coupon',
    isFloorPrize: false, stockTotal: 10, stockRemaining: 5, stockAwarded: 5, ...over,
  });

  const editReq = (body) => ({ params: { prizeId: String(PRIZE_ID) }, body, user: { _id: OWNER_ID } });

  beforeEach(() => {
    mockPrizeRepo.findDocById.mockReset();
    mockPrizeRepo.updateById.mockReset().mockResolvedValue({ _id: PRIZE_ID });
    mockPrizeRepo.countFloorPrizes.mockReset().mockResolvedValue(0);
    mockCampaignRepo.findById.mockReset().mockResolvedValue({ _id: CAMPAIGN_ID, status: 'live' });
  });

  it('lets an admin FIX a wrong coupon amount while the campaign runs', async () => {
    // The whole point of the edit screen. Correcting the discount must stay possible;
    // it is only the structural changes below that are refused.
    mockPrizeRepo.findDocById.mockResolvedValue(existingPrize({ isFloorPrize: true, stockTotal: null }));
    await controller.updatePrize(editReq({ couponValue: 500 }), res());
    expect(mockPrizeRepo.updateById).toHaveBeenCalledWith(
      String(PRIZE_ID), expect.objectContaining({ couponValue: 500 }),
    );
  });

  it('refuses to demote the ONLY guaranteed prize while live', async () => {
    mockPrizeRepo.findDocById.mockResolvedValue(existingPrize({ isFloorPrize: true, stockTotal: null }));
    await expect(controller.updatePrize(editReq({ isFloorPrize: false }), res()))
      .rejects.toMatchObject({ statusCode: 422 });
    expect(mockPrizeRepo.updateById).not.toHaveBeenCalled();
  });

  it('refuses to promote a SECOND prize to guaranteed', async () => {
    // findFloorPrize is a findOne — with two, which one backs the draw is whichever the
    // index happens to yield, so the odds stop matching what the admin was shown.
    mockPrizeRepo.findDocById.mockResolvedValue(existingPrize());
    mockPrizeRepo.countFloorPrizes.mockResolvedValue(1);
    await expect(controller.updatePrize(editReq({ isFloorPrize: true }), res()))
      .rejects.toMatchObject({ statusCode: 422 });
    expect(mockPrizeRepo.updateById).not.toHaveBeenCalled();
  });

  it('refuses to put a stock count on the guaranteed prize', async () => {
    // A guaranteed prize that can run out is not guaranteed.
    mockPrizeRepo.findDocById.mockResolvedValue(existingPrize({ isFloorPrize: true, stockTotal: null }));
    await expect(controller.updatePrize(editReq({ stockTotal: 50 }), res()))
      .rejects.toMatchObject({ statusCode: 422 });
  });

  it('refuses to change a prize TYPE while live', async () => {
    // A coupon turning into a goodie has no SKU, so the packer gets an order line
    // naming an item nobody can find on a shelf.
    mockPrizeRepo.findDocById.mockResolvedValue(existingPrize());
    await expect(controller.updatePrize(editReq({ kind: 'goodie' }), res()))
      .rejects.toMatchObject({ statusCode: 422 });
  });

  it('ALLOWS the same structural edits once the campaign is switched off', async () => {
    mockCampaignRepo.findById.mockResolvedValue({ _id: CAMPAIGN_ID, status: 'off' });
    mockPrizeRepo.findDocById.mockResolvedValue(existingPrize({ isFloorPrize: true, stockTotal: null }));
    await controller.updatePrize(editReq({ isFloorPrize: false }), res());
    expect(mockPrizeRepo.updateById).toHaveBeenCalled();
  });

  it('still refuses a stock total below what has already been awarded', async () => {
    mockPrizeRepo.findDocById.mockResolvedValue(existingPrize({ stockAwarded: 8 }));
    await expect(controller.updatePrize(editReq({ stockTotal: 3 }), res()))
      .rejects.toMatchObject({ statusCode: 422 });
  });
});

/**
 * Editing a campaign's window and goodie rate.
 *
 * All three used to be creation-only in the admin UI — the API accepted them, the screen
 * never offered them, so a mistyped end date could only be fixed by cloning. They are
 * editable now, with ONE refusal.
 */
describe('updateCampaign — window + rate edits', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const req = (body, id = 'camp-1') => ({ params: { id }, body, user: { _id: 'admin-1' } });
  const res = () => ({ json: jest.fn(), status: jest.fn().mockReturnThis() });

  beforeEach(() => {
    jest.clearAllMocks();
    mockResultRepo.countGrantedForCampaign.mockResolvedValue(0);
    mockCampaignRepo.updateById.mockImplementation(async (id, patch) => ({ _id: id, ...patch }));
  });

  it('saves the goodie rate without touching the dates', async () => {
    const r = res();
    await controller.updateCampaign(req({ goodieWinRatePercent: 35 }), r);
    expect(mockCampaignRepo.updateById).toHaveBeenCalledWith('camp-1', { goodieWinRatePercent: 35 });
    // No date in the patch → no need to look the campaign up at all.
    expect(mockResultRepo.countGrantedForCampaign).not.toHaveBeenCalled();
  });

  // Everything on the settings card reaches the database. These were all creation-only
  // in the admin UI until the card existed, so an order placed under the wrong name or
  // the wrong per-customer cap could only be fixed by cloning the whole campaign.
  it('saves the editable settings — name, segments, cap and terms', async () => {
    const r = res();
    await controller.updateCampaign(req({
      name: 'Diwali Spin 2026',
      segmentCount: 10,
      maxSpinsPerUserPerCampaign: 2,
      terms: 'One spin per paid order.',
    }), r);

    expect(mockCampaignRepo.updateById).toHaveBeenCalledWith('camp-1', {
      name: 'Diwali Spin 2026',
      segmentCount: 10,
      maxSpinsPerUserPerCampaign: 2,
      terms: 'One spin per paid order.',
    });
  });

  /*
    The campaign-wide gate on whether the wheel appears AT ALL. Distinct from the
    per-prize minimum, which only decides which prizes are in the pool: under this
    figure the customer sees no wheel, over it they see one that may still exclude the
    expensive prizes. It defaults to 0 and had no admin input until now, so in practice
    every campaign offered a spin on any paid order however small.
  */
  it('saves the campaign-wide minimum order value, in paise', async () => {
    const r = res();
    await controller.updateCampaign(req({ minOrderValuePaise: 200000 }), r); // ₹2,000
    expect(mockCampaignRepo.updateById).toHaveBeenCalledWith('camp-1', { minOrderValuePaise: 200000 });
  });

  it('accepts 0, meaning no minimum', async () => {
    const r = res();
    await controller.updateCampaign(req({ minOrderValuePaise: 0 }), r);
    expect(mockCampaignRepo.updateById).toHaveBeenCalledWith('camp-1', { minOrderValuePaise: 0 });
  });

  it('accepts a null per-customer cap, meaning unlimited', async () => {
    const r = res();
    await controller.updateCampaign(req({ maxSpinsPerUserPerCampaign: null }), r);
    expect(mockCampaignRepo.updateById).toHaveBeenCalledWith('camp-1', { maxSpinsPerUserPerCampaign: null });
  });

  // `status` moves only through publish/setStatus, which run the safety gate. A rename
  // must never be able to smuggle a campaign live.
  it('never lets a settings save change the status', async () => {
    const r = res();
    await controller.updateCampaign(req({ name: 'Renamed', status: 'live' }), r);
    expect(mockCampaignRepo.updateById).toHaveBeenCalledWith('camp-1', { name: 'Renamed' });
  });

  it('extends a campaign that is still running', async () => {
    mockCampaignRepo.findById.mockResolvedValue({ _id: 'camp-1', endsAt: new Date(Date.now() + DAY) });
    const r = res();
    const later = new Date(Date.now() + 10 * DAY).toISOString();
    await controller.updateCampaign(req({ endsAt: later }), r);
    expect(mockCampaignRepo.updateById).toHaveBeenCalledWith('camp-1', { endsAt: later });
  });

  it('shortens a closed campaign — nothing is reopened, so it is allowed', async () => {
    mockCampaignRepo.findById.mockResolvedValue({ _id: 'camp-1', endsAt: new Date(Date.now() - DAY) });
    mockResultRepo.countGrantedForCampaign.mockResolvedValue(50);
    const r = res();
    const earlier = new Date(Date.now() - 5 * DAY).toISOString();
    await controller.updateCampaign(req({ endsAt: earlier }), r);
    expect(mockCampaignRepo.updateById).toHaveBeenCalled();
  });

  it('reopens a closed campaign that was never spun', async () => {
    mockCampaignRepo.findById.mockResolvedValue({ _id: 'camp-1', endsAt: new Date(Date.now() - DAY) });
    mockResultRepo.countGrantedForCampaign.mockResolvedValue(0);
    const r = res();
    await controller.updateCampaign(req({ endsAt: new Date(Date.now() + DAY).toISOString() }), r);
    expect(mockCampaignRepo.updateById).toHaveBeenCalled();
  });

  /*
    THE REFUSAL. The per-customer cap counts granted spins per campaign for all time, so
    reopening a spent window locks every original spinner out with no error of any kind —
    they simply see no wheel. Cloning gives a fresh id and resets both the cap and stock.
  */
  it('REFUSES to reopen a closed campaign that has already been spun', async () => {
    mockCampaignRepo.findById.mockResolvedValue({ _id: 'camp-1', endsAt: new Date(Date.now() - DAY) });
    mockResultRepo.countGrantedForCampaign.mockResolvedValue(37);
    const r = res();

    await expect(controller.updateCampaign(
      req({ endsAt: new Date(Date.now() + DAY).toISOString() }), r,
    )).rejects.toMatchObject({ statusCode: 409 });

    expect(mockCampaignRepo.updateById).not.toHaveBeenCalled();
  });

  it('names the spin count and points at Clone, so the refusal is actionable', async () => {
    mockCampaignRepo.findById.mockResolvedValue({ _id: 'camp-1', endsAt: new Date(Date.now() - DAY) });
    mockResultRepo.countGrantedForCampaign.mockResolvedValue(37);
    const r = res();
    await expect(controller.updateCampaign(
      req({ endsAt: new Date(Date.now() + DAY).toISOString() }), r,
    )).rejects.toThrow(/37 time\(s\)[\s\S]*Clone for next window/);
  });
});
