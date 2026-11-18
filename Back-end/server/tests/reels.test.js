/**
 * Shoppable reels over HTTP (routes/reels.js, routes/adminReels.js).
 *
 * The cases a swipe-through demo misses: a pending/rejected/removed reel or a draft
 * product leaking into the public feed, cursor pages that skip or repeat, a double
 * like counting twice, a foreign or over-length upload being accepted, and — on the
 * money side — a reel tap crediting a suspended affiliate, the buyer themselves, or
 * beating a code the buyer typed.
 *
 * Cloudinary is mocked; whether a REAL upload passes verifyUploadedVideo is not proven
 * here (see the reels-backend notes).
 */
import { jest } from '@jest/globals';

const cloudinaryMock = {
  config: jest.fn(),
  url: jest.fn(() => ''),
  utils: { api_sign_request: jest.fn() },
  api: { resource: jest.fn(), delete_resources: jest.fn() },
  uploader: { destroy: jest.fn(), upload_stream: jest.fn() },
};
jest.unstable_mockModule('../config/cloudinary.js', () => ({ default: cloudinaryMock }));

const { default: request } = await import('supertest');
const { default: bcrypt } = await import('bcryptjs');
const { default: mongoose } = await import('mongoose');
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: User } = await import('../models/User.js');
const { default: Product } = await import('../models/Product.js');
const { default: Reel } = await import('../models/Reel.js');
const { default: ReelLike } = await import('../models/ReelLike.js');
const { default: ReelReport } = await import('../models/ReelReport.js');
const { default: Affiliate } = await import('../models/Affiliate.js');
const { default: Coupon } = await import('../models/Coupon.js');
const { AFFILIATE_STATUS, ATTRIBUTION_SOURCE } = await import('../config/affiliate.js');
const { resolveAttribution } = await import('../services/affiliateAttributionService.js');
const { REEL_STATUS } = await import('../config/reels.js');

const BASE = '/api/v1';
const PASSWORD = 'SecurePass123!';

const csrfFrom = (res) => {
  const c = (res.headers['set-cookie'] || []).find((x) => x.startsWith('XSRF-TOKEN='));
  return c ? c.split(';')[0].split('=')[1] : '';
};
const refCookie = (res) => (res.headers['set-cookie'] || []).find((c) => c.startsWith('ab_ref='));

/** A signed-in browser: agent + CSRF header on every write. */
async function signIn(email) {
  const agent = request.agent(app);
  const login = await agent.post(`${BASE}/auth/login`).send({ email, password: PASSWORD });
  expect(login.status).toBe(200);
  const token = csrfFrom(login);
  const w = (m) => (url, body) => agent[m](`${BASE}${url}`).set('X-XSRF-TOKEN', token).send(body);
  return { user: login.body.user, get: (url) => agent.get(`${BASE}${url}`), post: w('post'), del: w('delete') };
}

/** An anonymous browser with a CSRF token. */
async function anonymous() {
  const agent = request.agent(app);
  const res = await agent.get(`${BASE}/csrf-token`);
  const token = csrfFrom(res) || res.body?.csrfToken || '';
  return {
    get: (url) => agent.get(`${BASE}${url}`),
    post: (url, body) => agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', token).send(body),
  };
}

let hash;
const mkUser = async (name, email, role = 'customer', extra = {}) =>
  User.create({ name, email, role, passwordHash: hash, ...extra });

let seq = 0;
const mkProduct = (overrides = {}) => {
  seq += 1;
  return Product.create({
    name: `Seat cover ${seq}`,
    slug: `seat-cover-${seq}`,
    description: 'A seat cover',
    price: 800,
    originalPrice: 1000,
    averageRating: 4.46,
    totalReviews: 780,
    stock: 'low',
    images: [{ url: 'https://img.example.com/a.jpg', public_id: 'p/a' }],
    ...overrides,
  });
};

let reelSeq = 0;
const mkReel = (creator, product, overrides = {}) => {
  reelSeq += 1;
  const status = overrides.status || REEL_STATUS.APPROVED;
  return Reel.create({
    creator: creator?._id ?? null,
    uploadedBy: creator?._id ?? new mongoose.Types.ObjectId(),
    product: product._id,
    media: { publicId: `autobacs/reels/u_x/r${reelSeq}`, durationSec: 20, version: 1 },
    caption: `reel ${reelSeq}`,
    status,
    approvedAt: status === REEL_STATUS.APPROVED ? new Date(Date.now() - reelSeq * 1000) : null,
    ...overrides,
  });
};

const mkAffiliate = async (user, overrides = {}) => {
  const affiliate = await Affiliate.create({
    code: 'RAHUL10',
    name: user.name,
    email: user.email,
    phone: '+91 98765 43210',
    user: user._id,
    status: AFFILIATE_STATUS.ACTIVE,
    commissionPercent: 10,
    discountPercent: 8,
    ...overrides,
  });
  const coupon = await Coupon.create({
    code: affiliate.code, type: 'percentage', value: affiliate.discountPercent,
    visibility: 'hidden', affiliate: affiliate._id,
  });
  affiliate.coupon = coupon._id;
  await affiliate.save();
  return affiliate;
};

/** Default Cloudinary answer: a real 20s video in the asked-for folder. */
const videoResource = (publicId, over = {}) => ({
  public_id: publicId, resource_type: 'video', format: 'mp4', version: 1700000000,
  duration: 20, bytes: 5_000_000, width: 720, height: 1280, ...over,
});

describe('Reels API', () => {
  let admin; let creator; let buyer;

  beforeAll(async () => {
    await dbHandler.connect();
    hash = await bcrypt.hash(PASSWORD, await bcrypt.genSalt(4));
  });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });

  beforeEach(async () => {
    process.env.FRONTEND_URL = 'https://shop.example.com';
    process.env.CLOUDINARY_CLOUD_NAME = 'democloud';
    process.env.CLOUDINARY_API_KEY = 'key123';
    process.env.CLOUDINARY_API_SECRET = 'secret';
    cloudinaryMock.utils.api_sign_request.mockReturnValue('sig-abc');
    cloudinaryMock.api.resource.mockImplementation(async (id) => videoResource(id));
    cloudinaryMock.uploader.destroy.mockResolvedValue({ result: 'ok' });

    admin = await mkUser('Admin', 'admin@example.com', 'admin');
    creator = await mkUser('Rahul Creator', 'rahul@example.com', 'customer', { phone: '9876543210' });
    buyer = await mkUser('Bina Buyer', 'bina@example.com', 'customer', { phone: '9123456780' });
  });
  afterEach(async () => { await dbHandler.clearDatabase(); });

  // ── Feed visibility ─────────────────────────────────────────────────────────

  describe('public feed', () => {
    it('shows only approved reels with a live product; pending/rejected/removed never appear', async () => {
      const p = await mkProduct();
      const ok = await mkReel(creator, p);
      await mkReel(creator, p, { status: REEL_STATUS.PENDING });
      await mkReel(creator, p, { status: REEL_STATUS.REJECTED, rejectReason: 'blurry' });
      await mkReel(creator, p, { status: REEL_STATUS.REMOVED });

      const res = await (await anonymous()).get('/reels');
      expect(res.status).toBe(200);
      expect(res.body.reels.map((r) => r.id)).toEqual([String(ok._id)]);
      expect(res.body.nextCursor).toBeNull();
      expect(res.headers['cache-control']).toMatch(/no-store/);
    });

    it('builds the product block live: price, MRP, discount, rating, count, availability', async () => {
      const p = await mkProduct();
      await mkReel(creator, p);
      const [reel] = (await (await anonymous()).get('/reels')).body.reels;

      expect(reel.product).toMatchObject({
        id: String(p._id), slug: p.slug, title: p.name, image: 'https://img.example.com/a.jpg',
        price: 800, mrp: 1000, discountPercent: 20, averageRating: 4.5, ratingCount: 780,
        availability: 'low', hasVariants: false, festivalPrice: null,
      });
      expect(reel.creator).toEqual({ id: String(creator._id), name: 'Rahul Creator', avatarUrl: null });
      expect(reel.hlsUrl).toBe('https://res.cloudinary.com/democloud/video/upload/sp_auto/v1/autobacs/reels/u_x/r' + reel.caption.split(' ')[1] + '.m3u8');
      expect(reel.mp4Url).toMatch(/\/video\/upload\/c_limit,w_720,q_auto\/v1\/.+\.mp4$/);
      expect(reel.posterUrl).toMatch(/\/video\/upload\/so_1,c_limit,w_720,q_auto\/v1\/.+\.jpg$/);
      expect(reel.shareUrl).toBe(`https://shop.example.com/products/${p.slug}`);
      expect(reel.viewerLiked).toBe(false);
      expect(reel).not.toHaveProperty('rejectReason');

      // A price edit shows on the very next read — nothing was copied onto the reel.
      await Product.updateOne({ _id: p._id }, { $set: { price: 700 } });
      const [again] = (await (await anonymous()).get('/reels')).body.reels;
      expect(again.product.price).toBe(700);
      expect(again.product.discountPercent).toBe(30);
    });

    it('hides reels of a draft (inactive) or deleted product, in the feed and by id', async () => {
      const draft = await mkProduct({ isActive: false });
      const gone = await mkProduct({ deletedAt: new Date() });
      const live = await mkProduct();
      const hidden1 = await mkReel(creator, draft);
      const hidden2 = await mkReel(creator, gone);
      const shown = await mkReel(creator, live);

      const anon = await anonymous();
      const res = await anon.get('/reels');
      expect(res.body.reels.map((r) => r.id)).toEqual([String(shown._id)]);
      expect((await anon.get(`/reels/${hidden1._id}`)).status).toBe(404);
      expect((await anon.get(`/reels/${hidden2._id}`)).status).toBe(404);
      expect((await anon.get(`/reels/${shown._id}`)).status).toBe(200);
    });

    it('404s a pending reel by id, and a junk id', async () => {
      const p = await mkProduct();
      const pending = await mkReel(creator, p, { status: REEL_STATUS.PENDING });
      const anon = await anonymous();
      expect((await anon.get(`/reels/${pending._id}`)).status).toBe(404);
      expect((await anon.get('/reels/not-an-id')).status).toBe(404);
    });

    it('cursor pages walk every reel once, newest approval first, then stop', async () => {
      const p = await mkProduct();
      const made = [];
      for (let i = 0; i < 25; i += 1) made.push(await mkReel(creator, p));
      const anon = await anonymous();

      const seen = [];
      let cursor = null;
      const sizes = [];
      do {
        const res = await anon.get(`/reels?limit=10${cursor ? `&cursor=${cursor}` : ''}`);
        expect(res.status).toBe(200);
        sizes.push(res.body.reels.length);
        seen.push(...res.body.reels.map((r) => r.id));
        cursor = res.body.nextCursor;
      } while (cursor);

      expect(sizes).toEqual([10, 10, 5]);
      expect(new Set(seen).size).toBe(25);
      // mkReel gives later reels an older approvedAt, so creation order = feed order.
      expect(seen).toEqual(made.map((r) => String(r._id)));
    });

    it('a run of hidden-product reels does not end the feed early or repeat rows', async () => {
      const live = await mkProduct();
      const draft = await mkProduct({ isActive: false });
      const order = [];
      for (let i = 0; i < 4; i += 1) order.push(await mkReel(creator, live));
      for (let i = 0; i < 12; i += 1) await mkReel(creator, draft); // a long hidden run
      for (let i = 0; i < 4; i += 1) order.push(await mkReel(creator, live));
      const anon = await anonymous();

      const seen = [];
      let cursor = null;
      let pages = 0;
      do {
        const res = await anon.get(`/reels?limit=3${cursor ? `&cursor=${cursor}` : ''}`);
        seen.push(...res.body.reels.map((r) => r.id));
        cursor = res.body.nextCursor;
        pages += 1;
      } while (cursor && pages < 20);

      expect(seen).toEqual(order.map((r) => String(r._id)));
    });

    it('clamps the limit to 20 and rejects a forged cursor', async () => {
      const p = await mkProduct();
      for (let i = 0; i < 22; i += 1) await mkReel(creator, p);
      const anon = await anonymous();
      expect((await anon.get('/reels?limit=500')).body.reels).toHaveLength(20);
      expect((await anon.get('/reels?limit=-3')).body.reels).toHaveLength(10);
      expect((await anon.get('/reels?cursor=garbage')).status).toBe(400);
    });

    it('shows the festival price when the offer is live', async () => {
      const { default: FestivalOffer } = await import('../models/FestivalOffer.js');
      const { default: cacheService } = await import('../services/cacheService.js');
      const { FESTIVAL_OFFER_CACHE_TAG } = await import('../services/festivalOfferService.js');
      await FestivalOffer.create({ enabled: true, startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 86_400_000) });
      // Earlier tests cached "no offer" — the admin save path purges this tag too.
      await cacheService.invalidatePattern(FESTIVAL_OFFER_CACHE_TAG);
      const p = await mkProduct();
      await mkReel(creator, p);
      const [reel] = (await (await anonymous()).get('/reels')).body.reels;
      // ₹800 is in the 10% tier → ₹720 (display only; checkout recomputes).
      expect(reel.product.festivalPrice).toBe(720);
    });
  });

  // ── Upload ──────────────────────────────────────────────────────────────────

  describe('upload', () => {
    it('signs a direct upload into the caller’s own folder; never streams video through us', async () => {
      const me = await signIn(creator.email);
      const res = await me.post('/reels/upload-signature', {});
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        cloudName: 'democloud', apiKey: 'key123', signature: 'sig-abc', resourceType: 'video',
        folder: `autobacs/reels/u_${creator._id}`, maxDurationSec: 60,
        uploadUrl: 'https://api.cloudinary.com/v1_1/democloud/video/upload',
      });
      expect(res.body.params).toMatchObject({ folder: res.body.folder, eager: 'sp_auto/m3u8', timestamp: String(res.body.timestamp) });
      // Exactly the params handed back are the ones that were signed.
      expect(cloudinaryMock.utils.api_sign_request).toHaveBeenCalledWith(res.body.params, 'secret');
    });

    it('refuses the team folder to a customer, and needs sign-in', async () => {
      const me = await signIn(creator.email);
      expect((await me.post('/reels/upload-signature', { team: true })).status).toBe(403);
      expect((await (await anonymous()).post('/reels/upload-signature', {})).status).toBe(401);
      const staff = await signIn(admin.email);
      const team = await staff.post('/reels/upload-signature', { team: true });
      expect(team.body.folder).toBe('autobacs/reels/team');
    });

    it('creates a pending reel from a verified upload, and a retry returns the same reel', async () => {
      const p = await mkProduct();
      const me = await signIn(creator.email);
      const publicId = `autobacs/reels/u_${creator._id}/clip1`;

      const first = await me.post('/reels', { publicId, productId: String(p._id), caption: '  Great   fit  ' });
      expect(first.status).toBe(201);
      expect(first.body.reel).toMatchObject({ status: 'pending', caption: 'Great fit', durationSec: 20, rejectReason: null });

      const retry = await me.post('/reels', { publicId, productId: String(p._id), caption: 'x' });
      expect(retry.status).toBe(200);
      expect(retry.body.reel.id).toBe(first.body.reel.id);
      expect(await Reel.countDocuments()).toBe(1);

      // Pending is not public.
      expect((await (await anonymous()).get('/reels')).body.reels).toHaveLength(0);
    });

    it('refuses an upload outside the caller’s folder (someone else’s video)', async () => {
      const p = await mkProduct();
      const me = await signIn(buyer.email);
      const res = await me.post('/reels', { publicId: `autobacs/reels/u_${creator._id}/clip1`, productId: String(p._id) });
      expect(res.status).toBe(403);
      expect(cloudinaryMock.api.resource).not.toHaveBeenCalled();
      // u_<id> must not prefix-match u_<id>9.
      const res2 = await me.post('/reels', { publicId: `autobacs/reels/u_${buyer._id}9/clip`, productId: String(p._id) });
      expect(res2.status).toBe(403);
    });

    it('refuses a clip over 60 seconds and deletes the asset', async () => {
      const p = await mkProduct();
      const me = await signIn(creator.email);
      const publicId = `autobacs/reels/u_${creator._id}/long`;
      cloudinaryMock.api.resource.mockResolvedValueOnce(videoResource(publicId, { duration: 75 }));
      const res = await me.post('/reels', { publicId, productId: String(p._id) });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/60 seconds/);
      expect(cloudinaryMock.uploader.destroy).toHaveBeenCalledWith(publicId, expect.objectContaining({ resource_type: 'video' }));
      expect(await Reel.countDocuments()).toBe(0);
    });

    it.each([
      ['not a video', { resource_type: 'image' }, 400],
      ['unknown duration', { duration: undefined }, 400],
      ['too large', { bytes: 500 * 1024 * 1024 }, 400],
    ])('refuses an asset that is %s', async (_label, over, status) => {
      const p = await mkProduct();
      const me = await signIn(creator.email);
      const publicId = `autobacs/reels/u_${creator._id}/bad`;
      cloudinaryMock.api.resource.mockResolvedValueOnce(videoResource(publicId, over));
      expect((await me.post('/reels', { publicId, productId: String(p._id) })).status).toBe(status);
      expect(await Reel.countDocuments()).toBe(0);
    });

    it('400s a missing asset and 503s when Cloudinary is down (never accepts unchecked)', async () => {
      const p = await mkProduct();
      const me = await signIn(creator.email);
      const publicId = `autobacs/reels/u_${creator._id}/x`;
      cloudinaryMock.api.resource.mockRejectedValueOnce({ error: { http_code: 404 } });
      expect((await me.post('/reels', { publicId, productId: String(p._id) })).status).toBe(400);
      cloudinaryMock.api.resource.mockRejectedValueOnce(new Error('ETIMEDOUT'));
      expect((await me.post('/reels', { publicId, productId: String(p._id) })).status).toBe(503);
      expect(await Reel.countDocuments()).toBe(0);
    });

    it('refuses an inactive or unknown product', async () => {
      const draft = await mkProduct({ isActive: false });
      const me = await signIn(creator.email);
      const publicId = `autobacs/reels/u_${creator._id}/x`;
      expect((await me.post('/reels', { publicId, productId: String(draft._id) })).status).toBe(400);
      expect((await me.post('/reels', { publicId, productId: 'nope' })).status).toBe(400);
    });
  });

  // ── Likes / reports / views / mine ──────────────────────────────────────────

  describe('engagement', () => {
    it('like twice = one like; unlike twice = zero; viewerLiked reflects it', async () => {
      const p = await mkProduct();
      const reel = await mkReel(creator, p);
      const me = await signIn(buyer.email);

      const a = await me.post(`/reels/${reel._id}/like`);
      const b = await me.post(`/reels/${reel._id}/like`);
      expect(a.body).toMatchObject({ liked: true, likeCount: 1 });
      expect(b.body).toMatchObject({ liked: true, likeCount: 1 });
      expect(await ReelLike.countDocuments()).toBe(1);

      const [mine] = (await me.get('/reels')).body.reels;
      expect(mine.viewerLiked).toBe(true);
      expect(mine.likeCount).toBe(1);
      const [anonView] = (await (await anonymous()).get('/reels')).body.reels;
      expect(anonView.viewerLiked).toBe(false);

      await me.del(`/reels/${reel._id}/like`);
      const c = await me.del(`/reels/${reel._id}/like`);
      expect(c.body).toMatchObject({ liked: false, likeCount: 0 });
      expect(await ReelLike.countDocuments()).toBe(0);
    });

    it('concurrent likes by one person still make one like', async () => {
      const p = await mkProduct();
      const reel = await mkReel(creator, p);
      const me = await signIn(buyer.email);
      await Promise.all(Array.from({ length: 5 }, () => me.post(`/reels/${reel._id}/like`)));
      expect(await ReelLike.countDocuments()).toBe(1);
      expect((await Reel.findById(reel._id)).likeCount).toBe(1);
    });

    it('cannot like a pending reel, and liking needs sign-in', async () => {
      const p = await mkProduct();
      const pending = await mkReel(creator, p, { status: REEL_STATUS.PENDING });
      const me = await signIn(buyer.email);
      expect((await me.post(`/reels/${pending._id}/like`)).status).toBe(404);
      const live = await mkReel(creator, p);
      expect((await (await anonymous()).post(`/reels/${live._id}/like`)).status).toBe(401);
    });

    it('report is one per person per reel and needs a reason', async () => {
      const p = await mkProduct();
      const reel = await mkReel(creator, p);
      const me = await signIn(buyer.email);
      expect((await me.post(`/reels/${reel._id}/report`, {})).status).toBe(400);
      await me.post(`/reels/${reel._id}/report`, { reason: 'Misleading' });
      await me.post(`/reels/${reel._id}/report`, { reason: 'Misleading again' });
      expect(await ReelReport.countDocuments()).toBe(1);
      expect((await Reel.findById(reel._id)).reportCount).toBe(1);
    });

    it('view is accepted anonymously (202) and never errors without Redis', async () => {
      const p = await mkProduct();
      const reel = await mkReel(creator, p);
      const res = await (await anonymous()).post(`/reels/${reel._id}/view`).set('cf-connecting-ip', '203.0.113.9');
      expect(res.status).toBe(202);
    });

    it('/reels/mine lists the caller’s own reels in every state, with the reject reason', async () => {
      const p = await mkProduct();
      await mkReel(creator, p, { status: REEL_STATUS.PENDING });
      await mkReel(creator, p, { status: REEL_STATUS.REJECTED, rejectReason: 'Too dark' });
      await mkReel(buyer, p, { status: REEL_STATUS.PENDING });
      const me = await signIn(creator.email);
      const res = await me.get('/reels/mine');
      expect(res.status).toBe(200);
      expect(res.body.reels).toHaveLength(2);
      expect(res.body.reels.find((r) => r.status === 'rejected').rejectReason).toBe('Too dark');
      expect((await (await anonymous()).get('/reels/mine')).status).toBe(401);
    });
  });

  // ── Admin ───────────────────────────────────────────────────────────────────

  describe('admin moderation', () => {
    it('is closed to a signed-in customer', async () => {
      const me = await signIn(buyer.email);
      expect((await me.get('/admin/reels?status=pending')).status).toBe(403);
      const p = await mkProduct();
      const reel = await mkReel(creator, p, { status: REEL_STATUS.PENDING });
      expect((await me.post(`/admin/reels/${reel._id}/approve`)).status).toBe(403);
      expect((await Reel.findById(reel._id)).status).toBe('pending');
    });

    it('approve publishes; reject needs a reason and shows it to the creator; remove takes a live reel down', async () => {
      const p = await mkProduct();
      const a = await mkReel(creator, p, { status: REEL_STATUS.PENDING });
      const b = await mkReel(creator, p, { status: REEL_STATUS.PENDING });
      const staff = await signIn(admin.email);

      const queue = await staff.get('/admin/reels?status=pending');
      expect(queue.body.reels.map((r) => r.id).sort()).toEqual([String(a._id), String(b._id)].sort());
      expect(queue.body.reels[0]).toMatchObject({ reportCount: 0, viewCount: 0, source: 'customer', productLive: true });

      expect((await staff.post(`/admin/reels/${a._id}/approve`)).status).toBe(200);
      expect((await (await anonymous()).get('/reels')).body.reels.map((r) => r.id)).toEqual([String(a._id)]);

      expect((await staff.post(`/admin/reels/${b._id}/reject`, {})).status).toBe(400);
      const rej = await staff.post(`/admin/reels/${b._id}/reject`, { reason: 'Product not visible' });
      expect(rej.body.reel).toMatchObject({ status: 'rejected', rejectReason: 'Product not visible' });

      // Reject is for the queue only; a live reel is removed instead.
      expect((await staff.post(`/admin/reels/${a._id}/reject`, { reason: 'x' })).status).toBe(409);
      expect((await staff.post(`/admin/reels/${a._id}/remove`)).status).toBe(200);
      expect((await (await anonymous()).get('/reels')).body.reels).toHaveLength(0);
      // Removed is final.
      expect((await staff.post(`/admin/reels/${a._id}/approve`)).status).toBe(409);
      expect((await staff.post(`/admin/reels/${new mongoose.Types.ObjectId()}/approve`)).status).toBe(404);
    });

    it('approving twice is harmless (second is a 409, state unchanged)', async () => {
      const p = await mkProduct();
      const r = await mkReel(creator, p, { status: REEL_STATUS.PENDING });
      const staff = await signIn(admin.email);
      const [x, y] = await Promise.all([
        staff.post(`/admin/reels/${r._id}/approve`),
        staff.post(`/admin/reels/${r._id}/approve`),
      ]);
      expect([x.status, y.status].sort()).toEqual([200, 409]);
    });

    it('team upload is approved immediately and can credit a named customer', async () => {
      const p = await mkProduct();
      const staff = await signIn(admin.email);
      const res = await staff.post('/admin/reels', {
        publicId: 'autobacs/reels/team/seed1', productId: String(p._id), caption: 'Launch', creatorUserId: String(creator._id),
      });
      expect(res.status).toBe(201);
      expect(res.body.reel).toMatchObject({ status: 'approved', creator: { id: String(creator._id) } });
      const unnamed = await staff.post('/admin/reels', { publicId: 'autobacs/reels/team/seed2', productId: String(p._id) });
      expect(unnamed.body.reel.creator).toEqual({ id: null, name: 'Autobacs India', avatarUrl: null });
      // A team upload must come from the team folder.
      const foreign = await staff.post('/admin/reels', { publicId: `autobacs/reels/u_${creator._id}/c`, productId: String(p._id) });
      expect(foreign.status).toBe(403);
      expect((await (await anonymous()).get('/reels')).body.reels).toHaveLength(2);
    });

    it('rejects an unknown status filter', async () => {
      const staff = await signIn(admin.email);
      expect((await staff.get('/admin/reels?status=everything')).status).toBe(400);
    });
  });

  // ── Attribution (money-adjacent) ────────────────────────────────────────────

  describe('POST /reels/:id/attribute', () => {
    it('an ACTIVE affiliate creator: sets the same ab_ref cookie a link click sets', async () => {
      const aff = await mkAffiliate(creator);
      const p = await mkProduct();
      const reel = await mkReel(creator, p);
      const res = await (await anonymous()).post(`/reels/${reel._id}/attribute`, { amount: 1, code: 'EVIL' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      const cookie = refCookie(res);
      expect(cookie).toMatch(new RegExp(`^ab_ref=${aff.code};`));
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/SameSite=Lax/);
      expect(cookie).toMatch(/Max-Age=2592000/); // 30-day window
    });

    it.each([AFFILIATE_STATUS.SUSPENDED, AFFILIATE_STATUS.PENDING, AFFILIATE_STATUS.REJECTED])(
      'a %s affiliate creator credits nobody',
      async (status) => {
        await mkAffiliate(creator, { status });
        const p = await mkProduct();
        const reel = await mkReel(creator, p);
        const res = await (await anonymous()).post(`/reels/${reel._id}/attribute`);
        expect(res.status).toBe(200);
        expect(refCookie(res)).toBeUndefined();
      },
    );

    it('self-referral credits nobody: the creator tapping their own reel', async () => {
      await mkAffiliate(creator);
      const p = await mkProduct();
      const reel = await mkReel(creator, p);
      const me = await signIn(creator.email);
      const res = await me.post(`/reels/${reel._id}/attribute`);
      expect(res.status).toBe(200);
      expect(refCookie(res)).toBeUndefined();
    });

    it('self-referral by a second account with the same phone credits nobody', async () => {
      await mkAffiliate(creator);
      await mkUser('Rahul Alt', 'rahul.alt@example.com', 'customer', { phone: '+91 98765-43210' });
      const p = await mkProduct();
      const reel = await mkReel(creator, p);
      const alt = await signIn('rahul.alt@example.com');
      expect(refCookie(await alt.post(`/reels/${reel._id}/attribute`))).toBeUndefined();
    });

    it('a non-affiliate creator, a pending reel, or a team reel credits nobody', async () => {
      const p = await mkProduct();
      const plain = await mkReel(buyer, p);
      const anon = await anonymous();
      expect(refCookie(await anon.post(`/reels/${plain._id}/attribute`))).toBeUndefined();

      await mkAffiliate(creator);
      const pending = await mkReel(creator, p, { status: REEL_STATUS.PENDING });
      expect(refCookie(await anon.post(`/reels/${pending._id}/attribute`))).toBeUndefined();

      const team = await mkReel(null, p);
      expect(refCookie(await anon.post(`/reels/${team._id}/attribute`))).toBeUndefined();
    });

    it('at order time a typed affiliate code beats the reel', async () => {
      const reelAff = await mkAffiliate(creator);
      const other = await mkUser('Other Aff', 'other@example.com');
      const typedAff = await mkAffiliate(other, { code: 'OTHER5', email: 'other@example.com', phone: '9000011111' });

      // The cookie a reel tap set + a code the buyer typed (applied or not).
      const typedApplied = await resolveAttribution({
        cookieCode: reelAff.code, appliedCouponCode: typedAff.code, requestedCouponCode: typedAff.code, buyer: { userId: buyer._id },
      });
      expect(String(typedApplied.affiliate)).toBe(String(typedAff._id));
      expect(typedApplied.source).toBe(ATTRIBUTION_SOURCE.COUPON);

      const typedNotApplied = await resolveAttribution({
        cookieCode: reelAff.code, requestedCouponCode: typedAff.code, buyer: { userId: buyer._id },
      });
      expect(String(typedNotApplied.affiliate)).toBe(String(typedAff._id));
      expect(typedNotApplied.source).toBe(ATTRIBUTION_SOURCE.CODE);

      // No code typed → the reel creator is credited, like a link click.
      const reelOnly = await resolveAttribution({ cookieCode: reelAff.code, buyer: { userId: buyer._id } });
      expect(String(reelOnly.affiliate)).toBe(String(reelAff._id));
      expect(reelOnly.source).toBe(ATTRIBUTION_SOURCE.LINK);
    });

    it('at order time a guest-set reel cookie still credits nobody if the buyer is the creator', async () => {
      const reelAff = await mkAffiliate(creator);
      const result = await resolveAttribution({ cookieCode: reelAff.code, buyer: { userId: creator._id } });
      expect(result).toBeNull();
      // …and if the affiliate is suspended after the tap.
      await Affiliate.updateOne({ _id: reelAff._id }, { $set: { status: AFFILIATE_STATUS.SUSPENDED } });
      expect(await resolveAttribution({ cookieCode: reelAff.code, buyer: { userId: buyer._id } })).toBeNull();
    });
  });
});
