import request from 'supertest';
import mongoose from 'mongoose';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import User from '../models/User.js';
import DeliveryZone from '../models/DeliveryZone.js';
import * as dbHandler from './db-handler.js';
import bcrypt from 'bcryptjs';

describe('Delivery Zones API', () => {
  let adminId;
  let adminToken;
  let zoneId;

  const testAdmin = {
    name: 'Zone Admin',
    email: 'zoneadmin@example.com',
    password: 'password123',
    role: 'admin'
  };

  const testZone = {
    name: 'Test Metro Zone',
    type: 'metro',
    pinCodes: ['123456', '123457'],
    deliveryTime: {
      minDays: 2,
      maxDays: 4
    },
    shippingCost: {
      baseRate: 50,
      perKgRate: 10
    },
    isServiceable: true,
    priority: 1
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
    // Create admin
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(testAdmin.password, salt);
    
    const admin = await User.create({
      name: testAdmin.name,
      email: testAdmin.email,
      passwordHash,
      role: testAdmin.role
    });
    adminId = admin._id;

    // Login admin
    const loginRes = await request(app)
      .post('/auth/login')
      .send({
        email: testAdmin.email,
        password: testAdmin.password
      });
    adminToken = loginRes.body.accessToken;

    // Create delivery zone
    const zone = await DeliveryZone.create(testZone);
    zoneId = zone._id;
  });

  describe('Public Routes', () => {
    describe('GET /api/delivery-zones/pincode/:pinCode', () => {
      it('should return zone for valid pincode', async () => {
        const res = await request(app)
          .get('/api/delivery-zones/pincode/123456')
          .expect(200);

        expect(res.body.success).toBe(true);
        expect(res.body.zone.name).toBe(testZone.name);
      });

      it('should return 404 for invalid pincode', async () => {
        const res = await request(app)
          .get('/api/delivery-zones/pincode/999999')
          .expect(404);

        expect(res.body.success).toBe(false);
      });
    });

    describe('POST /api/delivery-zones/check-serviceability', () => {
      it('should confirm serviceability for valid pincode', async () => {
        const res = await request(app)
          .post('/api/delivery-zones/check-serviceability')
          .send({ pinCode: '123456' })
          .expect(200);

        expect(res.body.success).toBe(true);
        expect(res.body.serviceable).toBe(true);
      });

      it('should deny serviceability for invalid pincode', async () => {
        const res = await request(app)
          .post('/api/delivery-zones/check-serviceability')
          .send({ pinCode: '999999' })
          .expect(200); // Usually returns 200 with serviceable: false

        expect(res.body.success).toBe(true);
        expect(res.body.serviceable).toBe(false);
      });
    });

    describe('POST /api/delivery-zones/estimate', () => {
      it('should return delivery estimate', async () => {
        const res = await request(app)
          .post('/api/delivery-zones/estimate')
          .send({ pinCode: '123456' })
          .expect(200);

        expect(res.body.success).toBe(true);
        expect(res.body.deliveryDays).toBeDefined();
        expect(res.body.estimate).toBeDefined();
        expect(res.body.estimate.minDate).toBeDefined();
        expect(res.body.estimate.maxDate).toBeDefined();
      });
    });

    describe('POST /api/delivery-zones/shipping-cost', () => {
      it('should calculate shipping cost', async () => {
        const res = await request(app)
          .post('/api/delivery-zones/shipping-cost')
          .send({ 
            pinCode: '123456',
            weightKg: 2
          })
          .expect(200);

        expect(res.body.success).toBe(true);
        // 50 + (2 * 10) = 70
        expect(res.body.shippingCost).toBe(70);
      });
    });
  });

  describe('Admin Routes', () => {
    describe('GET /api/delivery-zones', () => {
      it('should list all zones as admin', async () => {
        const res = await request(app)
          .get('/api/delivery-zones')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);

        expect(res.body.success).toBe(true);
        expect(res.body.zones).toHaveLength(1);
      });
    });

    describe('POST /api/delivery-zones', () => {
      it('should create new zone as admin', async () => {
        const newZone = {
          name: 'New Remote Zone',
          type: 'remote',
          pinCodes: ['888888'],
          deliveryTime: {
            minDays: 5,
            maxDays: 10
          },
          shippingCost: {
            baseRate: 100,
            perKgRate: 20
          }
        };

        const res = await request(app)
          .post('/api/delivery-zones')
          .set('Authorization', `Bearer ${adminToken}`)
          .send(newZone)
          .expect(201);

        expect(res.body.success).toBe(true);
        expect(res.body.zone.name).toBe(newZone.name);
      });
    });

    describe('PUT /api/delivery-zones/:id', () => {
      it('should update zone as admin', async () => {
        const res = await request(app)
          .put(`/api/delivery-zones/${zoneId}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            shippingCost: {
              baseRate: 60,
              perKgRate: 15
            }
          })
          .expect(200);

        expect(res.body.success).toBe(true);
        expect(res.body.zone.shippingCost.baseRate).toBe(60);
      });
    });

    describe('DELETE /api/delivery-zones/:id', () => {
      it('should delete zone as admin', async () => {
        const res = await request(app)
          .delete(`/api/delivery-zones/${zoneId}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);

        expect(res.body.success).toBe(true);

        // Verify deletion
        const checkRes = await request(app)
          .get(`/api/delivery-zones/${zoneId}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(404);
      });
    });
  });
});
