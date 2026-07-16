import request from 'supertest';
import { jest } from '@jest/globals';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import elasticsearchService from '../services/elasticsearchService.js';
import User from '../models/User.js';
import Product from '../models/Product.js';
import Order from '../models/Order.js';
import Cart from '../models/Cart.js';
import * as dbHandler from './db-handler.js';
import bcrypt from 'bcryptjs';

// Increase timeout for this test file
jest.setTimeout(30000);

describe('Orders Integration API', () => {
  let userToken;
  let adminToken;
  let userId;
  let productId;
  let product;

  const testUser = {
    name: 'Order Test User',
    email: 'orderuser@example.com',
    password: 'password123',
    role: 'customer'
  };

  const adminUser = {
    name: 'Admin User',
    email: 'admin@example.com',
    password: 'password123',
    role: 'admin'
  };

  const testProduct = {
    name: 'Order Test Product',
    description: 'Test Description',
    price: 500,
    stock: 'in',
    images: [{ url: 'http://example.com/image.jpg', alt: 'Test Image' }],
    brand: 'Test Brand',
    category: 'Test Category',
    isActive: true
  };

  beforeAll(async () => {
    await dbHandler.connect();
  }, 60000);

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
    if (elasticsearchService && typeof elasticsearchService.shutdown === 'function') {
      await elasticsearchService.shutdown();
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

    // Create admin
    const adminHashedPassword = await bcrypt.hash(adminUser.password, salt);
    await User.create({
      ...adminUser,
      passwordHash: adminHashedPassword
    });

    // Login admin
    const adminLoginRes = await request(app)
      .post('/auth/login')
      .send({
        email: adminUser.email,
        password: adminUser.password
      });
    adminToken = adminLoginRes.body.accessToken;

    // Create product
    product = await Product.create(testProduct);
    productId = product._id;
  });

  describe('POST /orders', () => {
    it('should create a new order', async () => {
      const orderData = {
        items: [{
          product: productId,
          quantity: 2
        }],
        shippingAddress: {
          fullName: 'Test User',
          phone: '1234567890',
          addressLine1: '123 Test St',
          city: 'Test City',
          state: 'Test State',
          postalCode: '12345',
          country: 'India'
        },
        shippingCost: 50,
        tax: 0,
        discount: 0
      };

      const res = await request(app)
        .post('/orders')
        .set('Authorization', `Bearer ${userToken}`)
        .send(orderData)
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.order).toHaveProperty('_id');
      expect(res.body.order.items).toHaveLength(1);
      expect(res.body.order.items[0].product).toBe(productId.toString());
      expect(res.body.order.totalAmount).toBe(1050); // 500*2 + 50
    });

    it('should fail if product is out of stock', async () => {
       // Mark the product out of stock
       await Product.findByIdAndUpdate(productId, { stock: 'out' });

       const orderData = {
        items: [{
          product: productId,
          quantity: 2
        }],
        shippingAddress: {
          fullName: 'Test User',
          phone: '1234567890',
          addressLine1: '123 Test St',
          city: 'Test City',
          state: 'Test State',
          postalCode: '12345',
          country: 'India'
        }
      };

      const res = await request(app)
        .post('/orders')
        .set('Authorization', `Bearer ${userToken}`)
        .send(orderData)
        .expect(400);
      
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('out of stock');
    });
  });

  describe('GET /orders', () => {
    it('should get user orders', async () => {
      // Create an order first
      await Order.create({
        user: userId,
        items: [{
          product: productId,
          quantity: 1,
          price: 500,
          name: 'Test Product'
        }],
        shippingAddress: {
          fullName: 'Test User',
          phone: '1234567890',
          addressLine1: '123 Test St',
          city: 'Test City',
          state: 'Test State',
          postalCode: '12345'
        },
        subtotal: 500,
        totalAmount: 500,
        status: 'pending'
      });

      const res = await request(app)
        .get('/orders')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.orders).toHaveLength(1);
    });
  });

  describe('PUT /orders/:id/cancel', () => {
    it('should cancel an order', async () => {
      const order = await Order.create({
        user: userId,
        items: [{
          product: productId,
          quantity: 1,
          price: 500,
          name: 'Test Product'
        }],
        shippingAddress: {
          fullName: 'Test User',
          phone: '1234567890',
          addressLine1: '123 Test St',
          city: 'Test City',
          state: 'Test State',
          postalCode: '12345'
        },
        subtotal: 500,
        totalAmount: 500,
        status: 'pending'
      });

      const res = await request(app)
        .put(`/orders/${order._id}/cancel`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ reason: 'customer_request' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.order.status).toBe('cancelled');
    });
  });

  describe('GET /orders/:id', () => {
    it('should get order by id for owner', async () => {
      const order = await Order.create({
        user: userId,
        items: [{
          product: productId,
          quantity: 1,
          price: 500,
          name: 'Test Product'
        }],
        shippingAddress: {
          fullName: 'Test User',
          phone: '1234567890',
          addressLine1: '123 Test St',
          city: 'Test City',
          state: 'Test State',
          postalCode: '12345'
        },
        subtotal: 500,
        totalAmount: 500,
        status: 'pending'
      });

      const res = await request(app)
        .get(`/orders/${order._id}`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.order._id).toBe(order._id.toString());
    });

    it('should return 403 for unauthorized user', async () => {
      // Create another user
      const otherUser = await User.create({
        name: 'Other User',
        email: 'other@example.com',
        passwordHash: 'hash',
        role: 'customer'
      });
      // Login other user to get token
      const loginRes = await request(app)
        .post('/auth/login')
        .send({
          email: 'other@example.com',
          password: 'password123' 
        });
      
      // Actually, easier to just create an order for the *other* user and try to access with *current* userToken
      const otherOrder = await Order.create({
        user: otherUser._id,
        items: [{
          product: productId,
          quantity: 1,
          price: 100,
          name: 'Test Product'
        }],
        shippingAddress: {
          fullName: 'Other User',
          phone: '0987654321',
          addressLine1: '456 Other St',
          city: 'Other City',
          state: 'Other State',
          postalCode: '67890',
          country: 'India'
        },
        subtotal: 100,
        totalAmount: 100,
        status: 'pending'
      });

      await request(app)
        .get(`/orders/${otherOrder._id}`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);
    });

    it('should allow admin to access any order', async () => {
       const order = await Order.create({
        user: userId,
        items: [{
          product: productId,
          quantity: 1,
          price: 500,
          name: 'Test Product'
        }],
        shippingAddress: {
          fullName: 'Test User',
          phone: '1234567890',
          addressLine1: '123 Test St',
          city: 'Test City',
          state: 'Test State',
          postalCode: '12345',
          country: 'India'
        },
        subtotal: 500,
        totalAmount: 500,
        status: 'pending'
      });

      const res = await request(app)
        .get(`/orders/${order._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      
      expect(res.body.success).toBe(true);
    });
  });

  describe('PUT /orders/:id/status', () => {
    it('should allow admin to update status', async () => {
      const order = await Order.create({
        user: userId,
        items: [{ product: productId, quantity: 1, price: 500, name: 'Test Product' }],
        shippingAddress: {
          fullName: 'Test User',
          phone: '1234567890',
          addressLine1: '123 Test St',
          city: 'Test City',
          state: 'Test State',
          postalCode: '12345',
          country: 'India'
        },
        subtotal: 500,
        totalAmount: 500,
        status: 'pending'
      });

      const res = await request(app)
        .put(`/orders/${order._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ 
          status: 'processing',
          reason: 'admin_update'
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.order.status).toBe('processing');
    });

    it('should forbid non-admin from updating status', async () => {
      const order = await Order.create({
        user: userId,
        items: [{
          product: productId,
          quantity: 1,
          price: 500,
          name: 'Test Product'
        }],
        shippingAddress: {
          fullName: 'Test User',
          phone: '1234567890',
          addressLine1: '123 Test St',
          city: 'Test City',
          state: 'Test State',
          postalCode: '12345',
          country: 'India'
        },
        subtotal: 500,
        totalAmount: 500,
        status: 'pending'
      });

      await request(app)
        .put(`/orders/${order._id}/status`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ status: 'processing' })
        .expect(403);
    });
  });

  describe('GET /orders/admin/all', () => {
    const BASE = '/api/v1';
    // Auth here is httpOnly-cookie based; the token lands in Set-Cookie, not the body.
    // Pull it out and send as a (CSRF-exempt) Bearer — same pattern as cart.test.js.
    const loginBearer = async (email, password) => {
      const res = await request(app).post(`${BASE}/auth/login`).send({ email, password });
      const cookie = (res.headers['set-cookie'] || []).find(c => c.startsWith('accessToken='));
      return cookie ? cookie.split(';')[0].split('=')[1] : res.body.accessToken;
    };

    // Minimal valid order for the given user, overridable per-field.
    const seedOrder = (overrides = {}) => Order.create({
      user: userId,
      items: [{ product: productId, quantity: 1, price: 500, name: 'Test Product' }],
      shippingAddress: {
        fullName: 'Test User', phone: '1234567890', addressLine1: '123 Test St',
        city: 'Test City', state: 'Test State', postalCode: '12345', country: 'India'
      },
      subtotal: 500,
      totalAmount: 500,
      status: 'processing',
      ...overrides,
    });

    let admin;
    let customer;
    beforeEach(async () => {
      admin = await loginBearer(adminUser.email, adminUser.password);
      customer = await loginBearer(testUser.email, testUser.password);
    });

    it('returns a nested pagination object with hasNext/hasPrev', async () => {
      for (let i = 0; i < 12; i++) await seedOrder();

      const res = await request(app)
        .get(`${BASE}/orders/admin/all?page=1&limit=5`)
        .set('Authorization', `Bearer ${admin}`)
        .expect(200);

      expect(res.body.orders).toHaveLength(5);
      expect(res.body.pagination).toMatchObject({
        total: 12, pages: 3, currentPage: 1, limit: 5, hasNext: true, hasPrev: false,
      });

      const last = await request(app)
        .get(`${BASE}/orders/admin/all?page=3&limit=5`)
        .set('Authorization', `Bearer ${admin}`)
        .expect(200);
      expect(last.body.orders).toHaveLength(2);
      expect(last.body.pagination).toMatchObject({ currentPage: 3, hasNext: false, hasPrev: true });
    });

    it('filters by a single status', async () => {
      await seedOrder({ status: 'processing' });
      await seedOrder({ status: 'delivered' });
      await seedOrder({ status: 'delivered' });

      const res = await request(app)
        .get(`${BASE}/orders/admin/all?status=delivered`)
        .set('Authorization', `Bearer ${admin}`)
        .expect(200);

      expect(res.body.total).toBe(2);
      expect(res.body.orders.every(o => o.status === 'delivered')).toBe(true);
    });

    it('filters by multiple comma-joined statuses and ignores unknown ones', async () => {
      await seedOrder({ status: 'processing' });
      await seedOrder({ status: 'delivered' });
      await seedOrder({ status: 'cancelled' });

      // `pending` is a legacy value not in the enum — it must be dropped, not zero the result.
      const res = await request(app)
        .get(`${BASE}/orders/admin/all?status=processing,delivered,pending`)
        .set('Authorization', `Bearer ${admin}`)
        .expect(200);

      expect(res.body.total).toBe(2);
    });

    it('returns an empty page when a status filter has only invalid values', async () => {
      await seedOrder({ status: 'processing' });
      await seedOrder({ status: 'delivered' });

      // A filter that survives to zero real statuses is an explicit "none of these" —
      // it must not silently widen back to every order.
      const res = await request(app)
        .get(`${BASE}/orders/admin/all?status=pending`)
        .set('Authorization', `Bearer ${admin}`)
        .expect(200);

      expect(res.body.total).toBe(0);
      expect(res.body.orders).toHaveLength(0);
    });

    it('filters by amount range', async () => {
      await seedOrder({ subtotal: 100, totalAmount: 100 });
      await seedOrder({ subtotal: 5000, totalAmount: 5000 });
      await seedOrder({ subtotal: 20000, totalAmount: 20000 });

      const res = await request(app)
        .get(`${BASE}/orders/admin/all?minAmount=1000&maxAmount=10000`)
        .set('Authorization', `Bearer ${admin}`)
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.orders[0].totalAmount).toBe(5000);
    });

    it('filters by customer name/email', async () => {
      await seedOrder();
      const salt = await bcrypt.genSalt(10);
      const jane = await User.create({
        name: 'Jane Buyer', email: 'jane.buyer@example.com',
        passwordHash: await bcrypt.hash('password123', salt), role: 'customer',
      });
      await seedOrder({ user: jane._id, totalAmount: 999, subtotal: 999 });

      const res = await request(app)
        .get(`${BASE}/orders/admin/all?customer=jane`)
        .set('Authorization', `Bearer ${admin}`)
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.orders[0].totalAmount).toBe(999);
    });

    it('returns an empty page when the customer matches nobody', async () => {
      await seedOrder();

      const res = await request(app)
        .get(`${BASE}/orders/admin/all?customer=nobody-here-xyz`)
        .set('Authorization', `Bearer ${admin}`)
        .expect(200);

      expect(res.body.total).toBe(0);
      expect(res.body.orders).toHaveLength(0);
    });

    it('sorts by amount ascending when requested', async () => {
      await seedOrder({ subtotal: 300, totalAmount: 300 });
      await seedOrder({ subtotal: 100, totalAmount: 100 });
      await seedOrder({ subtotal: 200, totalAmount: 200 });

      const res = await request(app)
        .get(`${BASE}/orders/admin/all?sortBy=totalAmount&sortOrder=asc`)
        .set('Authorization', `Bearer ${admin}`)
        .expect(200);

      const amounts = res.body.orders.map(o => o.totalAmount);
      expect(amounts).toEqual([...amounts].sort((a, b) => a - b));
      expect(amounts[0]).toBe(100);
    });

    it('unified search finds an order by the buyer name (was empty before)', async () => {
      await seedOrder();
      const salt = await bcrypt.genSalt(10);
      const zoe = await User.create({
        name: 'Zoe Shopper', email: 'zoe.shopper@example.com', phone: '9998887777',
        passwordHash: await bcrypt.hash('password123', salt), role: 'customer',
      });
      await seedOrder({ user: zoe._id, totalAmount: 888, subtotal: 888 });

      const res = await request(app)
        .get(`${BASE}/orders/admin/all?search=zoe`)
        .set('Authorization', `Bearer ${admin}`)
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.orders[0].totalAmount).toBe(888);
    });

    it('unified search finds an order by the recipient name on the order itself', async () => {
      await seedOrder();
      await seedOrder({
        totalAmount: 654, subtotal: 654,
        shippingAddress: {
          fullName: 'Rajesh Kumar', phone: '9123456780', addressLine1: '9 Road',
          city: 'Pune', state: 'MH', postalCode: '411001', country: 'India',
        },
      });

      const res = await request(app)
        .get(`${BASE}/orders/admin/all?search=Rajesh`)
        .set('Authorization', `Bearer ${admin}`)
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.orders[0].totalAmount).toBe(654);
    });

    it('unified search finds an order by the recipient phone on the order', async () => {
      await seedOrder(); // phone 1234567890
      await seedOrder({
        totalAmount: 543, subtotal: 543,
        shippingAddress: {
          fullName: 'Meera', phone: '9555000111', addressLine1: '2 Lane',
          city: 'Delhi', state: 'DL', postalCode: '110001', country: 'India',
        },
      });

      const res = await request(app)
        .get(`${BASE}/orders/admin/all?search=9555000111`)
        .set('Authorization', `Bearer ${admin}`)
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.orders[0].totalAmount).toBe(543);
    });

    it('unified search still finds an order by the trailing hex of its id', async () => {
      await seedOrder();
      const target = await seedOrder({ totalAmount: 321, subtotal: 321 });
      const visibleId = target._id.toString().slice(-8);

      const res = await request(app)
        .get(`${BASE}/orders/admin/all?search=${visibleId}`)
        .set('Authorization', `Bearer ${admin}`)
        .expect(200);

      // The id lane matches the target; recipient lanes on the shared 'Test User' /
      // phone don't match a hex id fragment, so the target is the only hit.
      expect(res.body.orders.some(o => o.totalAmount === 321)).toBe(true);
    });

    it('finds an order by the trailing hex of its id (the visible order #)', async () => {
      await seedOrder();
      const target = await seedOrder({ totalAmount: 777, subtotal: 777 });
      const visibleId = target._id.toString().slice(-8);

      const res = await request(app)
        .get(`${BASE}/orders/admin/all?orderNumber=${visibleId}`)
        .set('Authorization', `Bearer ${admin}`)
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.orders[0].totalAmount).toBe(777);
    });

    it('rejects a non-admin', async () => {
      await request(app)
        .get(`${BASE}/orders/admin/all`)
        .set('Authorization', `Bearer ${customer}`)
        .expect(403);
    });
  });
});
