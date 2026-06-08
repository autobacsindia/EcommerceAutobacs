import request from 'supertest';
import { app } from '../app.js';
import User from '../models/User.js';
import * as dbHandler from './db-handler.js';
import bcrypt from 'bcryptjs';

// Extract a named cookie's value from a set-cookie header array.
function getCookieValue(setCookieHeaders, name) {
  const cookie = (setCookieHeaders || []).find(c => c.startsWith(`${name}=`));
  return cookie ? cookie.split(';')[0].substring(name.length + 1) : null;
}

describe('Profile Integration API', () => {
  let accessToken;
  let userId;

  const testUser = {
    name: 'Profile Test User',
    email: 'profileuser@example.com',
    password: 'password123',
    role: 'customer',
  };

  const secondUser = {
    name: 'Second User',
    email: 'second@example.com',
    password: 'password123',
    role: 'customer',
  };

  beforeAll(async () => {
    await dbHandler.connect();
  }, 120000);

  afterEach(async () => {
    await dbHandler.clearDatabase();
  });

  afterAll(async () => {
    await dbHandler.closeDatabase();
  });

  beforeEach(async () => {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(testUser.password, salt);
    const user = await User.create({ ...testUser, passwordHash: hashedPassword, isVerified: true });
    userId = user._id;

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: testUser.email, password: testUser.password });

    // Tokens are cookies-only; extract accessToken to use as Bearer
    // (Bearer header bypasses CSRF, avoiding the need to manage XSRF-TOKEN in tests)
    accessToken = getCookieValue(loginRes.headers['set-cookie'], 'accessToken');
  });

  describe('GET /profile', () => {
    it('should return user profile without passwordHash', async () => {
      const res = await request(app)
        .get('/api/v1/profile')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user).toHaveProperty('name', testUser.name);
      expect(res.body.user).toHaveProperty('email', testUser.email);
      expect(res.body.user).not.toHaveProperty('passwordHash');
    });

    it('should return 401 if not authenticated', async () => {
      const res = await request(app).get('/api/v1/profile');
      expect(res.statusCode).toBe(401);
    });
  });

  describe('PUT /profile', () => {
    it('should update user name', async () => {
      const newName = 'Updated Name';
      const res = await request(app)
        .put('/api/v1/profile')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: newName, email: testUser.email });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.name).toBe(newName);

      const user = await User.findById(userId);
      expect(user.name).toBe(newName);
    });

    it('should update user email', async () => {
      const newEmail = 'updated@example.com';
      const res = await request(app)
        .put('/api/v1/profile')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: testUser.name, email: newEmail });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.email).toBe(newEmail);

      const user = await User.findById(userId);
      expect(user.email).toBe(newEmail);
    });

    it('should update user addresses', async () => {
      const addresses = [
        {
          fullName: 'Test User',
          phone: '1234567890',
          addressLine1: '123 Main St',
          city: 'New York',
          state: 'NY',
          postalCode: '10001',
          country: 'USA',
          isDefault: true,
        },
      ];

      const res = await request(app)
        .put('/api/v1/profile')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: testUser.name, email: testUser.email, addresses });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.addresses).toHaveLength(1);
      expect(res.body.user.addresses[0].addressLine1).toBe('123 Main St');
    });

    it('should fail if email is already taken', async () => {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(secondUser.password, salt);
      await User.create({ ...secondUser, passwordHash: hashedPassword });

      const res = await request(app)
        .put('/api/v1/profile')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: testUser.name, email: secondUser.email });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Email is already taken');
    });
  });
});
