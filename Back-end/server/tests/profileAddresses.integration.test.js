import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app } from '../app.js';
import User from '../models/User.js';
import * as dbHandler from './db-handler.js';

const cookie = (headers, name) => {
  const c = (headers || []).find((h) => h.startsWith(`${name}=`));
  return c ? c.split(';')[0].substring(name.length + 1) : null;
};

const addr = (over = {}) => ({
  fullName: 'Tanveer Singh', phone: '+91 98765 43210', addressLine1: '12 MG Road',
  city: 'Kochi', state: 'Kerala', postalCode: '682001', ...over,
});

describe('/profile/addresses', () => {
  let token;
  let userId;
  const email = 'tanveer@example.com';

  beforeAll(async () => { await dbHandler.connect(); }, 120000);
  afterEach(async () => { await dbHandler.clearDatabase(); });
  afterAll(async () => { await dbHandler.closeDatabase(); });

  beforeEach(async () => {
    const passwordHash = await bcrypt.hash('SecurePass123!', 10);
    const user = await User.create({ name: 'Tanveer Singh', email, passwordHash, role: 'customer', isVerified: true });
    userId = user._id;
    const login = await request(app).post('/api/v1/auth/login').send({ email, password: 'SecurePass123!' });
    token = cookie(login.headers['set-cookie'], 'accessToken');
  });

  const put = (addresses) =>
    request(app).put('/api/v1/profile/addresses').set('Authorization', `Bearer ${token}`).send({ addresses });

  it('saves a list and reads it back, with one default', async () => {
    const res = await put([addr(), addr({ city: 'Kollam', postalCode: '691001' })]);
    expect(res.status).toBe(200);
    expect(res.body.addresses).toHaveLength(2);
    expect(res.body.addresses[0].phone).toBe('9876543210');

    const got = await request(app).get('/api/v1/profile/addresses').set('Authorization', `Bearer ${token}`);
    expect(got.status).toBe(200);
    expect(got.body.addresses.map((a) => a.isDefault)).toEqual([true, false]);
  });

  it('changes NOTHING but the addresses', async () => {
    // PUT /profile sets name and email unconditionally on every call; this
    // endpoint must not be able to touch them at all.
    await put([addr()]);
    const user = await User.findById(userId).lean();
    expect(user.email).toBe(email);
    expect(user.name).toBe('Tanveer Singh');
  });

  it('rejects a bad PIN with a readable message and leaves the old list intact', async () => {
    await put([addr()]);
    const bad = await put([addr({ postalCode: '12' })]);
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/PIN code must be 6 digits/);
    const user = await User.findById(userId).lean();
    expect(user.addresses).toHaveLength(1);
  });

  it('make-default round trip: read, flip the flag, write back', async () => {
    // Exactly what the app does. A first version of this test compared
    // address ids and passed VACUOUSLY — every id was undefined, because the
    // schema stores none — so it now asserts on contents.
    await put([addr(), addr({ city: 'Kollam', postalCode: '691001' })]);
    const read = await request(app).get('/api/v1/profile/addresses').set('Authorization', `Bearer ${token}`);
    const flipped = read.body.addresses.map((a, i) => ({ ...a, isDefault: i === 1 }));
    const res = await put(flipped);
    expect(res.body.addresses.map((a) => [a.city, a.isDefault])).toEqual([['Kochi', false], ['Kollam', true]]);
  });

  it('removing one address keeps the other, which becomes the default', async () => {
    await put([addr(), addr({ city: 'Kollam', postalCode: '691001' })]);
    const res = await put([addr({ city: 'Kollam', postalCode: '691001' })]);
    expect(res.body.addresses.map((a) => [a.city, a.isDefault])).toEqual([['Kollam', true]]);
  });

  it('requires sign-in', async () => {
    const res = await request(app).get('/api/v1/profile/addresses');
    expect(res.status).toBe(401);
  });
});
