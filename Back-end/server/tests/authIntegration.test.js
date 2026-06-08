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

describe('Auth Integration API', () => {
  const testUser = {
    name: 'Auth Test User',
    email: 'authtest@example.com',
    password: 'password123',
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

  // ── Registration ──────────────────────────────────────────────────────────────

  describe('POST /auth/register', () => {
    it('should register a new user and set token cookies', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send(testUser);

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.user.email).toBe(testUser.email.toLowerCase());
      expect(res.body.user.role).toBe('customer');
      // Tokens are cookies-only (not in response body)
      expect(res.body.accessToken).toBeUndefined();
      const cookies = res.headers['set-cookie'] || [];
      expect(cookies.some(c => c.startsWith('accessToken='))).toBe(true);
      expect(cookies.some(c => c.startsWith('refreshToken='))).toBe(true);
    });

    it('should not expose passwordHash in register response', async () => {
      const res = await request(app).post('/api/v1/auth/register').send(testUser);
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/);
    });

    it('should fail with duplicate email', async () => {
      await request(app).post('/api/v1/auth/register').send(testUser);
      const res = await request(app).post('/api/v1/auth/register').send(testUser);
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/exists/i);
    });

    it('should fail with invalid email', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ ...testUser, email: 'invalid-email' });
      expect(res.statusCode).toBe(400);
    });

    it('should fail with short password', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ ...testUser, password: '123' });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── Login ─────────────────────────────────────────────────────────────────────

  describe('POST /auth/login', () => {
    beforeEach(async () => {
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(testUser.password, salt);
      await User.create({
        name: testUser.name,
        email: testUser.email,
        passwordHash,
        isVerified: true,
      });
    });

    it('should login successfully and set token cookies', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: testUser.email, password: testUser.password });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.email).toBe(testUser.email.toLowerCase());
      // Tokens are cookies-only
      expect(res.body.accessToken).toBeUndefined();
      const cookies = res.headers['set-cookie'] || [];
      expect(cookies.some(c => c.startsWith('accessToken='))).toBe(true);
      expect(cookies.some(c => c.startsWith('refreshToken='))).toBe(true);
    });

    it('should fail with invalid password', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: testUser.email, password: 'wrongpassword' });
      expect(res.statusCode).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should fail with non-existent email', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'nonexistent@example.com', password: 'password123' });
      expect(res.statusCode).toBe(401);
    });

    it('should not expose passwordHash in login response', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: testUser.email, password: testUser.password });
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/);
    });
  });

  // ── Token refresh ─────────────────────────────────────────────────────────────

  describe('POST /auth/refresh', () => {
    it('should issue new accessToken cookie using refreshToken cookie', async () => {
      // Create a verified user so the isVerified guard in /auth/refresh doesn't block
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(testUser.password, salt);
      await User.create({ name: testUser.name, email: testUser.email, passwordHash, isVerified: true });

      const agent = request.agent(app);
      await agent.post('/api/v1/auth/login').send({ email: testUser.email, password: testUser.password });

      // /auth/refresh is excluded from CSRF — no X-XSRF-TOKEN needed
      const res = await agent.post('/api/v1/auth/refresh');

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      const cookies = res.headers['set-cookie'] || [];
      expect(cookies.some(c => c.startsWith('accessToken='))).toBe(true);
    });

    it('should reject an invalid refreshToken in request body', async () => {
      // No valid cookie in jar, so body token is used; it is invalid → 401
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'definitely.not.valid' });
      expect(res.statusCode).toBe(401);
    });
  });

  // ── Single-session logout ─────────────────────────────────────────────────────

  describe('POST /auth/logout', () => {
    it('should logout and revoke the refresh token', async () => {
      // Create a verified user so login succeeds
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(testUser.password, salt);
      await User.create({ name: testUser.name, email: testUser.email, passwordHash, isVerified: true });

      const agent = request.agent(app);
      const loginRes = await agent
        .post('/api/v1/auth/login')
        .send({ email: testUser.email, password: testUser.password });

      // Extract token values before logout
      const accessToken = getCookieValue(loginRes.headers['set-cookie'], 'accessToken');
      const refreshToken = getCookieValue(loginRes.headers['set-cookie'], 'refreshToken');

      // Bearer header bypasses CSRF (logout has no protect middleware, but CSRF
      // middleware enforces XSRF for cookie-bearing requests)
      const logoutRes = await agent
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(logoutRes.statusCode).toBe(200);
      expect(logoutRes.body.success).toBe(true);

      // After logout the refreshToken cookie is cleared from the agent.
      // Send the extracted token in the body to verify it was revoked in the DB.
      const refreshRes = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken });
      expect(refreshRes.statusCode).toBe(401);
    });
  });
});
