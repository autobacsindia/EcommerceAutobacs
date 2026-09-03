
import request from 'supertest';
import mongoose from 'mongoose';
import { app } from '../app.js';
import User from '../models/User.js';
import Product from '../models/Product.js';
import Order from '../models/Order.js';
import * as dbHandler from './db-handler.js';
import { API, accessTokenFrom } from './helpers/api.js';
import bcrypt from 'bcryptjs';

describe('Orders API', () => {
  let userId;
  let authToken;
  let productId;
  let orderId;

  const testUser = {
    name: 'Order Test User',
    email: 'ordertest@example.com',
    password: 'SecurePass123!'
  };

  const testProduct = {
    name: 'Test Order Product',
    description: 'Product for order testing',
    price: 1000,
    category: new mongoose.Types.ObjectId(),
    stock: 'in',
    images: [{ url: 'http://example.com/image.jpg', alt: 'Test Image' }],
    specifications: new Map([['Color', 'Red']]),
    compatibility: new Map([['Model', 'Test Model']]),
    isActive: true
  };

  const testAddress = {
    fullName: 'Order Test User',
    addressLine1: '123 Test St',
    city: 'Test City',
    state: 'Test State',
    postalCode: '12345',
    country: 'Test Country',
    phone: '9876543210'
  };

  beforeAll(async () => {
    await dbHandler.connect();
  });

  afterEach(async () => {
    await dbHandler.clearDatabase();
  });

  afterAll(async () => {
    await dbHandler.closeDatabase();
  });

  beforeEach(async () => {
    // Create test user
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(testUser.password, salt);
    
    const user = await User.create({
      name: testUser.name,
      email: testUser.email,
      passwordHash,
      role: 'customer'
    });
    
    userId = user._id;
    
    // Login to get auth token
    const loginRes = await request(app)
      .post(`${API}/auth/login`)
      .send({
        email: testUser.email,
        password: testUser.password
      });
      
    authToken = accessTokenFrom(loginRes);
    
    // Create test product
    const product = await Product.create(testProduct);
    productId = product._id;
  });

  describe('POST /orders', () => {
    it('should create a new order', async () => {
      const res = await request(app)
        .post(`${API}/orders`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          items: [
            { product: productId, quantity: 2 }
          ],
          shippingAddress: testAddress,
          shippingCost: 50,
          tax: 10,
          // Required since buyerService gated order creation on a recorded
          // acceptance of the Terms + Privacy Policy.
          acceptTerms: true
        })
        .expect(201);
        
      expect(res.body.success).toBe(true);
      expect(res.body.order).toBeDefined();
      // `pending` is the PAYMENT status; the fulfilment axis opens at
      // `awaiting_payment` (see the enum on models/Order.js).
      expect(res.body.order.status).toBe('awaiting_payment');
      expect(res.body.order.items).toHaveLength(1);

      // The client sent `tax: 10` and it is NOT in the total — the server recomputes
      // every money field from the catalogue and its own tax/shipping rules, so a
      // client-supplied tax is display-only input it is free to ignore. The old
      // assertion here expected 2060 (client tax honoured), which would have made a
      // tampering vector look like correct behaviour.
      expect(res.body.order.totalAmount).toBe(2050); // (1000 * 2) + 50 shipping, tax server-computed
    });

    it('ignores a client-supplied totalAmount', async () => {
      // The money invariant, asserted directly: sending an absurd total must not
      // change what the server charges.
      const res = await request(app)
        .post(`${API}/orders`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          items: [{ product: productId, quantity: 2 }],
          shippingAddress: testAddress,
          shippingCost: 50,
          totalAmount: 1, // attacker-supplied
          acceptTerms: true,
        })
        .expect(201);

      expect(res.body.order.totalAmount).toBe(2050);
    });

    it('should fail if product out of stock', async () => {
      await Product.findByIdAndUpdate(productId, { stock: 'out' });

      const res = await request(app)
        .post(`${API}/orders`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          items: [
            { product: productId, quantity: 1 }
          ],
          shippingAddress: testAddress,
          acceptTerms: true
        })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('out of stock');

      // restore for subsequent tests
      await Product.findByIdAndUpdate(productId, { stock: 'in' });
    });

    it('should fail without shipping address', async () => {
      const res = await request(app)
        .post(`${API}/orders`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          items: [
            { product: productId, quantity: 1 }
          ]
        })
        .expect(400);
        
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /orders', () => {
    beforeEach(async () => {
      // Create a test order
      await Order.create({
        user: userId,
        items: [{
          product: productId,
          quantity: 1,
          price: 1000,
          name: 'Test Product'
        }],
        shippingAddress: testAddress,
        subtotal: 1000,
        totalAmount: 1000,
        status: 'awaiting_payment'
      });
    });

    it('should get user orders', async () => {
      const res = await request(app)
        .get(`${API}/orders`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
        
      expect(res.body.success).toBe(true);
      expect(res.body.orders).toHaveLength(1);
      expect(res.body.count).toBe(1);
    });
  });

  describe('GET /orders/:id', () => {
    beforeEach(async () => {
      const order = await Order.create({
        user: userId,
        items: [{
          product: productId,
          quantity: 1,
          price: 1000,
          name: 'Test Product'
        }],
        shippingAddress: testAddress,
        subtotal: 1000,
        totalAmount: 1000,
        status: 'awaiting_payment'
      });
      orderId = order._id;
    });

    it('should get order by id', async () => {
      const res = await request(app)
        .get(`${API}/orders/${orderId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
        
      expect(res.body.success).toBe(true);
      expect(res.body.order._id).toBe(orderId.toString());
    });

    it('should fail for non-existent order', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .get(`${API}/orders/${fakeId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
        
      expect(res.body.success).toBe(false);
    });
  });
});
