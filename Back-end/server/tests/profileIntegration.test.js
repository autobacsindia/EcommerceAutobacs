import request from 'supertest';
import { jest } from '@jest/globals';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import User from '../models/User.js';
import * as dbHandler from './db-handler.js';
import bcrypt from 'bcryptjs';

// Increase timeout for this test file
jest.setTimeout(30000);

describe('Profile Integration API', () => {
  let userToken;
  let userId;
  
  const testUser = {
    name: 'Profile Test User',
    email: 'profileuser@example.com',
    password: 'password123',
    role: 'customer'
  };

  const secondUser = {
    name: 'Second User',
    email: 'second@example.com',
    password: 'password123',
    role: 'customer'
  };

  beforeAll(async () => {
    await dbHandler.connect();
  });

  afterEach(async () => {
    await dbHandler.clearDatabase();
  });

  afterAll(async () => {
    await dbHandler.closeDatabase();
    // Shutdown services to prevent open handles
    if (cronService && typeof cronService.shutdown === 'function') {
      cronService.shutdown();
    }
    if (adaptiveThrottlingService && typeof adaptiveThrottlingService.shutdown === 'function') {
      adaptiveThrottlingService.shutdown();
    }
  });

  beforeEach(async () => {
    // Create customer
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(testUser.password, salt);
    const user = await User.create({
      ...testUser,
      passwordHash: hashedPassword
    });
    userId = user._id;

    // Login customer
    const loginRes = await request(app)
      .post('/auth/login')
      .send({
        email: testUser.email,
        password: testUser.password
      });
    userToken = loginRes.body.accessToken;
  });

  describe('GET /profile', () => {
    it('should return user profile', async () => {
      const res = await request(app)
        .get('/profile')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user).toHaveProperty('name', testUser.name);
      expect(res.body.user).toHaveProperty('email', testUser.email);
      expect(res.body.user).not.toHaveProperty('passwordHash');
    });

    it('should return 401 if not authenticated', async () => {
      const res = await request(app).get('/profile');
      expect(res.statusCode).toBe(401);
    });
  });

  describe('PUT /profile', () => {
    it('should update user name', async () => {
      const newName = 'Updated Name';
      const res = await request(app)
        .put('/profile')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          name: newName,
          email: testUser.email
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.name).toBe(newName);
      
      // Verify in DB
      const user = await User.findById(userId);
      expect(user.name).toBe(newName);
    });

    it('should update user email', async () => {
      const newEmail = 'updated@example.com';
      const res = await request(app)
        .put('/profile')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          name: testUser.name,
          email: newEmail
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.email).toBe(newEmail);
      
      // Verify in DB
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
          isDefault: true
        }
      ];

      const res = await request(app)
        .put('/profile')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          name: testUser.name,
          email: testUser.email,
          addresses
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.addresses).toHaveLength(1);
      expect(res.body.user.addresses[0].addressLine1).toBe('123 Main St');
    });

    it('should fail if email is already taken', async () => {
      // Create another user
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(secondUser.password, salt);
      await User.create({
        ...secondUser,
        passwordHash: hashedPassword
      });

      // Try to update profile to use second user's email
      const res = await request(app)
        .put('/profile')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          name: testUser.name,
          email: secondUser.email
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Email is already taken');
    });
  });
});
