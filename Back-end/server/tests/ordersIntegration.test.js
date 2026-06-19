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
});
