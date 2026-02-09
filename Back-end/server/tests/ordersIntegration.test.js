import request from 'supertest';
import { jest } from '@jest/globals';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
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
    stock: 100,
    images: [{ url: 'http://example.com/image.jpg', alt: 'Test Image' }],
    brand: 'Test Brand',
    category: 'Test Category',
    isActive: true
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

    it('should fail if stock is insufficient', async () => {
       // Update stock to 1
       await Product.findByIdAndUpdate(productId, { stock: 1 });

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
      expect(res.body.message).toContain('Insufficient stock');
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
});
