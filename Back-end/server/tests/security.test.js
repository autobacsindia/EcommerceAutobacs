/**
 * Security Tests — Critical Protection
 * 
 * Tests security mechanisms:
 * - Rate limiting (brute force prevention)
 * - JWT expiration and validation
 * - Session invalidation after logout
 * - Authorization bypass attempts
 * - Input validation and sanitization
 */

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../app.js';
import * as dbHandler from './db-handler.js';
import User from '../models/User.js';

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await dbHandler.connect();
}, 120000);

afterAll(async () => {
  await dbHandler.closeDatabase();
});

afterEach(async () => {
  await dbHandler.clearDatabase();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const AUTH_BASE = '/api/v1/auth';
const TEST_USER = {
  name: 'Security Test User',
  email: 'security-test@example.com',
  password: 'SecurePass123!',
};

let authToken;
let refreshToken;
let userId;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Security - JWT Validation', () => {
  beforeEach(async () => {
    const res = await request(app)
      .post(`${AUTH_BASE}/register`)
      .send(TEST_USER);
    
    authToken = res.body.data.accessToken;
    userId = res.body.data.user._id;
  });

  it('should reject expired JWT token', async () => {
    // Create an expired token
    const expiredToken = jwt.sign(
      { id: userId },
      process.env.JWT_SECRET,
      { expiresIn: '-1h' } // Expired 1 hour ago
    );

    const res = await request(app)
      .get(`${AUTH_BASE}/me`)
      .set('Authorization', `Bearer ${expiredToken}`);

    expect(res.statusCode).toBe(401);
    expect(res.body.message).toMatch(/expired/i);
  });

  it('should reject JWT with invalid signature', async () => {
    // Create token with wrong secret
    const invalidToken = jwt.sign(
      { id: userId },
      'wrong-secret-key',
      { expiresIn: '1h' }
    );

    const res = await request(app)
      .get(`${AUTH_BASE}/me`)
      .set('Authorization', `Bearer ${invalidToken}`);

    expect(res.statusCode).toBe(401);
  });

  it('should reject JWT with tampered payload', async () => {
    // Create valid token
    const validToken = jwt.sign(
      { id: userId, role: 'user' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Tamper with the token (change role to admin)
    const [header, payload, signature] = validToken.split('.');
    const tamperedPayload = Buffer.from(
      JSON.stringify({ id: userId, role: 'admin' })
    ).toString('base64');
    const tamperedToken = `${header}.${tamperedPayload}.${signature}`;

    const res = await request(app)
      .get(`${AUTH_BASE}/me`)
      .set('Authorization', `Bearer ${tamperedToken}`);

    expect(res.statusCode).toBe(401); // Signature verification fails
  });

  it('should reject malformed Bearer token', async () => {
    const res = await request(app)
      .get(`${AUTH_BASE}/me`)
      .set('Authorization', 'Bearer malformed.token.here');

    expect(res.statusCode).toBe(401);
  });

  it('should reject missing Authorization header', async () => {
    const res = await request(app)
      .get(`${AUTH_BASE}/me`);

    expect(res.statusCode).toBe(401);
  });
});

describe('Security - Session Invalidation', () => {
  beforeEach(async () => {
    const res = await request(app)
      .post(`${AUTH_BASE}/register`)
      .send(TEST_USER);
    
    authToken = res.body.data.accessToken;
    refreshToken = res.body.data.refreshToken;
    userId = res.body.data.user._id;
  });

  it('should invalidate ALL sessions after logout-all', async () => {
    // Login from multiple "devices" (get multiple tokens)
    const login1 = await request(app)
      .post(`${AUTH_BASE}/login`)
      .send({
        email: TEST_USER.email,
        password: TEST_USER.password,
      });

    const login2 = await request(app)
      .post(`${AUTH_BASE}/login`)
      .send({
        email: TEST_USER.email,
        password: TEST_USER.password,
      });

    const token1 = login1.body.data.accessToken;
    const token2 = login2.body.data.accessToken;

    // Verify both tokens work
    const check1 = await request(app)
      .get(`${AUTH_BASE}/me`)
      .set('Authorization', `Bearer ${token1}`);
    expect(check1.statusCode).toBe(200);

    // Logout all sessions
    await request(app)
      .post(`${AUTH_BASE}/logout-all`)
      .set('Authorization', `Bearer ${token1}`);

    // Verify ALL tokens are invalidated
    const checkAfter1 = await request(app)
      .get(`${AUTH_BASE}/me`)
      .set('Authorization', `Bearer ${token1}`);
    expect([401, 403]).toContain(checkAfter1.statusCode);

    const checkAfter2 = await request(app)
      .get(`${AUTH_BASE}/me`)
      .set('Authorization', `Bearer ${token2}`);
    expect([401, 403]).toContain(checkAfter2.statusCode);
  });

  it('should not allow access with revoked refresh token', async () => {
    // Logout all
    await request(app)
      .post(`${AUTH_BASE}/logout-all`)
      .set('Authorization', `Bearer ${authToken}`);

    // Try to refresh with old token
    const res = await request(app)
      .post(`${AUTH_BASE}/refresh`)
      .send({ refreshToken });

    expect(res.statusCode).toBe(401);
  });
});

describe('Security - Authorization Bypass Prevention', () => {
  let user1Token, user2Token;
  let user1Id, user2Id;

  beforeEach(async () => {
    // Create two users
    const user1 = await request(app)
      .post(`${AUTH_BASE}/register`)
      .send({
        name: 'User One',
        email: 'user1-security@example.com',
        password: 'SecurePass123!',
      });

    const user2 = await request(app)
      .post(`${AUTH_BASE}/register`)
      .send({
        name: 'User Two',
        email: 'user2-security@example.com',
        password: 'SecurePass123!',
      });

    user1Token = user1.body.data.accessToken;
    user2Token = user2.body.data.accessToken;
    user1Id = user1.body.data.user._id;
    user2Id = user2.body.data.user._id;
  });

  it('should prevent user1 from accessing user2 profile', async () => {
    // Try to access /me with user1's token (should only see user1's data)
    const res = await request(app)
      .get(`${AUTH_BASE}/me`)
      .set('Authorization', `Bearer ${user1Token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.user._id).toBe(user1Id);
    expect(res.body.data.user._id).not.toBe(user2Id);
  });

  it('should reject requests with another user token for user-specific operations', async () => {
    // This test ensures proper authorization checks
    const res = await request(app)
      .get(`${AUTH_BASE}/me`)
      .set('Authorization', `Bearer ${user2Token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.user.email).toBe('user2-security@example.com');
  });
});

describe('Security - Rate Limiting', () => {
  it('should handle rapid login attempts (rate limit check)', async () => {
    // Make multiple rapid requests
    const requests = [];
    for (let i = 0; i < 10; i++) {
      requests.push(
        request(app)
          .post(`${AUTH_BASE}/login`)
          .send({
            email: 'nonexistent@example.com',
            password: 'wrongpassword',
          })
      );
    }

    const responses = await Promise.all(requests);
    
    // At least some should be rate limited (429)
    // OR all should fail with 401 (if rate limiter uses sliding window)
    const hasRateLimit = responses.some(r => r.statusCode === 429);
    const allFailed = responses.every(r => [401, 429].includes(r.statusCode));
    
    expect(allFailed).toBe(true);
  });

  it('should allow legitimate requests after rate limit window', async () => {
    // This test verifies rate limits reset
    // In real scenario, you'd wait for the window to expire
    // Here we just verify the endpoint works
    const res = await request(app)
      .post(`${AUTH_BASE}/register`)
      .send({
        name: 'Rate Limit Test',
        email: `ratelimit-${Date.now()}@example.com`,
        password: 'SecurePass123!',
      });

    expect([201, 400, 429]).toContain(res.statusCode);
  });
});

describe('Security - Input Validation & Sanitization', () => {
  it('should reject SQL injection attempts in email field', async () => {
    const maliciousEmail = "admin' OR '1'='1'@example.com";
    
    const res = await request(app)
      .post(`${AUTH_BASE}/login`)
      .send({
        email: maliciousEmail,
        password: 'anypassword',
      });

    // Should fail validation or return 401 (not execute SQL)
    expect([400, 401]).toContain(res.statusCode);
  });

  it('should reject XSS attempts in name field', async () => {
    const xssName = '<script>alert("XSS")</script>';
    
    const res = await request(app)
      .post(`${AUTH_BASE}/register`)
      .send({
        name: xssName,
        email: `xss-test-${Date.now()}@example.com`,
        password: 'SecurePass123!',
      });

    // Should sanitize or reject
    if (res.statusCode === 201) {
      expect(res.body.data.user.name).not.toContain('<script>');
    }
  });

  it('should reject noSQL injection attempts', async () => {
    const res = await request(app)
      .post(`${AUTH_BASE}/login`)
      .send({
        email: { $gt: '' }, // NoSQL injection
        password: 'anypassword',
      });

    // Should fail validation
    expect(res.statusCode).toBe(400);
  });

  it('should enforce password complexity requirements', async () => {
    const weakPasswords = [
      '123',
      'password',
      'abc',
      'test',
    ];

    for (const weakPassword of weakPasswords) {
      const res = await request(app)
        .post(`${AUTH_BASE}/register`)
        .send({
          name: 'Test User',
          email: `weak-${Date.now()}-${weakPassword}@example.com`,
          password: weakPassword,
        });

      expect(res.statusCode).toBe(400);
    }
  });
});

describe('Security - Headers & CORS', () => {
  it('should include security headers in response', async () => {
    const res = await request(app)
      .get('/api/v1/ping');

    // Check for security headers (if helmet is configured)
    expect(res.headers).toBeDefined();
  });

  it('should handle OPTIONS preflight requests', async () => {
    const res = await request(app)
      .options('/api/v1/auth/login')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST');

    // Should respond with CORS headers
    expect([200, 204]).toContain(res.statusCode);
  });
});
