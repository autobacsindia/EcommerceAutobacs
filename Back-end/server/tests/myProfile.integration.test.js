/**
 * "My profile" — PUT /profile and POST /profile/avatar for customers and staff.
 *
 * The contract: a person edits only their OWN profile; role, team, email,
 * sessionVersion and anything else outside the allow-list are ignored even
 * when sent; photos must really be images within the size limit; and past
 * orders keep the name and address they were placed with.
 *
 * ESM: storage is mocked with jest.unstable_mockModule() before app is imported.
 */
import { jest } from '@jest/globals';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import * as dbHandler from './db-handler.js';

const putPublicAsset = jest.fn();
const deleteHostedImages = jest.fn();
jest.unstable_mockModule('../services/storage/publicUploads.js', () => ({ putPublicAsset }));
jest.unstable_mockModule('../services/storage/publicImageDeletes.js', () => ({ deleteHostedImages }));

const { app } = await import('../app.js');
const { default: User } = await import('../models/User.js');
const { default: Order } = await import('../models/Order.js');

const BASE = '/api/v1';
// A real 1×1 PNG, so the magic-byte check passes.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

let seq = 0;
async function signIn(role, extra = {}) {
  seq += 1;
  const email = `${role}${seq}@example.com`;
  const password = 'SecurePass123!';
  const user = await User.create({
    name: `${role} person`, email, passwordHash: await bcrypt.hash(password, 10), role, isVerified: true, ...extra,
  });
  const res = await request(app).post(`${BASE}/auth/login`).send({ email, password });
  const cookie = (res.headers['set-cookie'] || []).find((c) => c.startsWith('accessToken='));
  const token = cookie ? cookie.split(';')[0].slice('accessToken='.length) : res.body.accessToken;
  return { user, token, email, password };
}
const put = (token, body) => request(app).put(`${BASE}/profile`).set('Authorization', `Bearer ${token}`).send(body);

beforeAll(async () => { await dbHandler.connect(); }, 120000);
afterEach(async () => { await dbHandler.clearDatabase(); jest.clearAllMocks(); });
afterAll(async () => { await dbHandler.closeDatabase(); });

beforeEach(() => {
  putPublicAsset.mockResolvedValue({ secure_url: 'https://img.example.com/autobacs/users/new.png', public_id: 'autobacs/users/new' });
  deleteHostedImages.mockResolvedValue(undefined);
});

describe('PUT /profile — editing my own profile', () => {
  it('a customer saves name and phone; the phone is stored as 10 digits', async () => {
    const { user, token } = await signIn('customer');
    const res = await put(token, { name: '  Abishek  S ', phone: '+91 98765 43210' }).expect(200);
    expect(res.body.user).toMatchObject({ name: 'Abishek S', phone: '9876543210' });
    const saved = await User.findById(user._id).lean();
    expect(saved).toMatchObject({ name: 'Abishek S', phone: '9876543210' });
  });

  it('a staff member saves job title, date of birth, emergency contact and bio', async () => {
    const { user, token } = await signIn('staff', { staff: { team: 'sales' } });
    const res = await put(token, {
      profile: {
        jobTitle: 'Sales Executive', dateOfBirth: '1995-08-21',
        emergencyContact: { name: 'Ravi (brother)', phone: '98400 12345' }, bio: 'Handles Chennai leads.',
      },
    }).expect(200);
    expect(res.body.user.profile).toEqual({
      jobTitle: 'Sales Executive', dateOfBirth: '1995-08-21',
      emergencyContact: { name: 'Ravi (brother)', phone: '9840012345' }, bio: 'Handles Chennai leads.',
    });
    expect(res.body.user.teamLabel).toBeTruthy();
    const saved = await User.findById(user._id).lean();
    expect(saved.profile.jobTitle).toBe('Sales Executive');
  });

  it('a customer cannot store staff-only fields', async () => {
    const { user, token } = await signIn('customer');
    await put(token, { name: 'Asha', profile: { jobTitle: 'CEO', bio: 'x' } }).expect(200);
    const saved = await User.findById(user._id).lean();
    expect(saved.profile).toBeUndefined();
  });

  it('sending only the name leaves the phone alone; an empty phone clears it', async () => {
    const { user, token } = await signIn('customer', { phone: '9876543210' });
    await put(token, { name: 'New Name' }).expect(200);
    expect((await User.findById(user._id).lean()).phone).toBe('9876543210');
    await put(token, { phone: '' }).expect(200);
    expect((await User.findById(user._id).lean()).phone).toBeUndefined();
  });

  it('checkout still saves addresses through PUT /profile (name + email + addresses)', async () => {
    const { user, token, email } = await signIn('customer');
    const addresses = [{ fullName: 'Asha', phone: '9876543210', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' }];
    await put(token, { name: 'customer person', email, addresses }).expect(200);
    const saved = await User.findById(user._id).lean();
    expect(saved.addresses).toHaveLength(1);
    expect(saved.addresses[0].isDefault).toBe(true);
  });
});

describe('PUT /profile — what it refuses', () => {
  it('role, team, email, sessionVersion and other fields are ignored even when sent', async () => {
    const { user, token, email } = await signIn('staff', { staff: { team: 'sales' } });
    const before = await User.findById(user._id).lean();
    await put(token, {
      name: 'Still Me',
      role: 'admin', staff: { team: 'accounts', isHead: true }, email: 'takeover@example.com',
      sessionVersion: 99, isVerified: false, karmaPoints: 1e6, wallet: { balance: 1e6 }, permissions: ['*'],
    }).expect(200);
    const after = await User.findById(user._id).lean();
    expect(after.name).toBe('Still Me');
    expect(after.role).toBe('staff');
    expect(after.staff.team).toBe('sales');
    expect(after.staff.isHead).toBe(false);
    expect(after.email).toBe(email);
    expect(after.sessionVersion).toBe(before.sessionVersion);
    expect(after.isVerified).toBe(true);
    expect(after.karmaPoints).toBe(0);
    expect(after.wallet?.balance ?? 0).toBe(0);
  });

  it('a body with only forbidden fields is refused, not silently "saved"', async () => {
    const { token } = await signIn('customer');
    const res = await put(token, { role: 'admin' }).expect(400);
    expect(res.body.success).toBe(false);
  });

  it("cannot edit someone else's profile — there is no way to name another user", async () => {
    const victim = await signIn('customer');
    const attacker = await signIn('customer');
    await put(attacker.token, { name: 'Hacked', _id: String(victim.user._id), id: String(victim.user._id), userId: String(victim.user._id) }).expect(200);
    expect((await User.findById(victim.user._id).lean()).name).toBe('customer person');
    expect((await User.findById(attacker.user._id).lean()).name).toBe('Hacked');
    // And no /profile/:id route exists to address them directly.
    const direct = await request(app).put(`${BASE}/profile/${victim.user._id}`).set('Authorization', `Bearer ${attacker.token}`).send({ name: 'Hacked' });
    expect(direct.status).toBe(404);
    expect((await User.findById(victim.user._id).lean()).name).toBe('customer person');
  });

  it("refuses a phone number that is already on another account", async () => {
    await User.create({ name: 'Guest', email: 'guest@example.com', passwordHash: 'x', phone: '+919876543210', isGuest: true });
    const { token } = await signIn('customer');
    const res = await put(token, { phone: '98765 43210' }).expect(400);
    expect(res.body.message).toMatch(/another account/);
  });

  it.each([
    [{ name: '' }, /Name is required/],
    [{ name: 'x'.repeat(81) }, /at most 80/],
    [{ name: { $gt: '' } }, /must be text/],
    [{ phone: '12345' }, /10-digit/],
  ])('rejects bad input %j', async (body, message) => {
    const { token } = await signIn('customer');
    const res = await put(token, body).expect(400);
    expect(res.body.message).toMatch(message);
  });

  it.each([
    [{ dateOfBirth: '2026-02-31' }, /not a real date/],
    [{ dateOfBirth: '2999-01-01' }, /in the past/],
    [{ bio: 'x'.repeat(201) }, /at most 200/],
    [{ emergencyContact: { name: 'Ravi' } }, /both a name and a phone/],
  ])('rejects bad staff input %j', async (profile, message) => {
    const { token } = await signIn('staff', { staff: { team: 'sales' } });
    const res = await put(token, { profile }).expect(400);
    expect(res.body.message).toMatch(message);
  });

  it('is refused when signed out — never a 200', async () => {
    // 403 from the CSRF guard (no Bearer, no cookie) or 401 from protect; either way, not saved.
    const res = await request(app).put(`${BASE}/profile`).send({ name: 'x' });
    expect([401, 403]).toContain(res.status);
    const bearerless = await request(app).put(`${BASE}/profile`).set('Authorization', 'Bearer not-a-token').send({ name: 'x' });
    expect(bearerless.status).toBe(401);
  });
});

describe('POST /profile/avatar', () => {
  const upload = (token, buf, name, type) =>
    request(app).post(`${BASE}/profile/avatar`).set('Authorization', `Bearer ${token}`).attach('avatar', buf, { filename: name, contentType: type });

  it('stores a real PNG and deletes the old photo only after the new one is saved', async () => {
    const { user, token } = await signIn('customer', { avatar: { url: 'https://img.example.com/old.png', public_id: 'autobacs/users/old' } });
    const res = await upload(token, PNG, 'me.png', 'image/png').expect(200);
    expect(res.body.avatar.url).toBe('https://img.example.com/autobacs/users/new.png');
    expect((await User.findById(user._id).lean()).avatar.public_id).toBe('autobacs/users/new');
    expect(deleteHostedImages).toHaveBeenCalledWith([{ public_id: 'autobacs/users/old', url: 'https://img.example.com/old.png' }]);
  });

  it('rejects a file that is not an image type', async () => {
    const { token } = await signIn('customer');
    await upload(token, Buffer.from('%PDF-1.4 nope'), 'cv.pdf', 'application/pdf').expect(400);
    expect(putPublicAsset).not.toHaveBeenCalled();
  });

  it('rejects a file that claims to be a PNG but is not one', async () => {
    const { token } = await signIn('customer');
    await upload(token, Buffer.from('<script>alert(1)</script>'), 'evil.png', 'image/png').expect(400);
    expect(putPublicAsset).not.toHaveBeenCalled();
  });

  it('rejects an oversized image', async () => {
    const { token } = await signIn('customer');
    const big = Buffer.concat([PNG, Buffer.alloc(4 * 1024 * 1024)]);
    const res = await upload(token, big, 'big.png', 'image/png');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(putPublicAsset).not.toHaveBeenCalled();
  });
});

describe('Past orders are snapshots', () => {
  it('editing name, phone and addresses does not change an existing order', async () => {
    const { user, token } = await signIn('customer', { phone: '9000000001' });
    const order = await Order.create({
      user: user._id,
      items: [{ product: new mongoose.Types.ObjectId(), name: 'Wax', price: 500, quantity: 1 }],
      shippingAddress: { fullName: 'Old Name', phone: '9000000001', addressLine1: '1 Old Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
      subtotal: 500, totalAmount: 500, status: 'processing', paymentStatus: 'paid',
    });
    const before = await Order.findById(order._id).lean();

    await put(token, {
      name: 'New Name', phone: '9876543210',
      addresses: [{ fullName: 'New Name', phone: '9876543210', addressLine1: '9 New Street', city: 'Chennai', state: 'Tamil Nadu', postalCode: '600073' }],
    }).expect(200);

    const after = await Order.findById(order._id).lean();
    expect(after.shippingAddress).toEqual(before.shippingAddress);
    expect(after.items).toEqual(before.items);
    expect(after.totalAmount).toBe(500);
  });
});

describe('Login and account regression checks', () => {
  it('login still works after a profile edit, and /auth/me shows the new name and photo', async () => {
    const { token, email, password } = await signIn('customer');
    await put(token, { name: 'Renamed' }).expect(200);
    await upload200(token);
    const login = await request(app).post(`${BASE}/auth/login`).send({ email, password }).expect(200);
    expect(login.body.success).toBe(true);
    const me = await request(app).get(`${BASE}/auth/me`).set('Authorization', `Bearer ${token}`).expect(200);
    const u = me.body.user ?? me.body.data?.user ?? me.body;
    expect(u.name).toBe('Renamed');
    expect(u.avatar).toBe('https://img.example.com/autobacs/users/new.png');
  });

  it('GET /profile returns the form shape and never secrets', async () => {
    const { token } = await signIn('staff', { staff: { team: 'sales' } });
    const res = await request(app).get(`${BASE}/profile`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.me).toMatchObject({ role: 'staff', profile: { jobTitle: '', dateOfBirth: '', bio: '' } });
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/passwordHash|refreshTokens|staffPasswordView|resetPasswordToken/);
  });

  it('wrong password still fails login with a non-200', async () => {
    const { email } = await signIn('customer');
    const res = await request(app).post(`${BASE}/auth/login`).send({ email, password: 'WrongPass123!' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('GET /staff/photos is panel-only and lists people who have a photo', async () => {
    const customer = await signIn('customer');
    await request(app).get(`${BASE}/staff/photos`).set('Authorization', `Bearer ${customer.token}`).expect(403);
    const staff = await signIn('staff', { staff: { team: 'sales' }, avatar: { url: 'https://img.example.com/s.png', public_id: 's' } });
    const res = await request(app).get(`${BASE}/staff/photos`).set('Authorization', `Bearer ${staff.token}`).expect(200);
    expect(res.body.photos[String(staff.user._id)]).toBe('https://img.example.com/s.png');
    expect(res.body.photos[String(customer.user._id)]).toBeUndefined();
  });
});

async function upload200(token) {
  await request(app).post(`${BASE}/profile/avatar`).set('Authorization', `Bearer ${token}`)
    .attach('avatar', PNG, { filename: 'me.png', contentType: 'image/png' }).expect(200);
}
