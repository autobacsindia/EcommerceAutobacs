import request from 'supertest';
import mongoose from 'mongoose';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import User from '../models/User.js';
import Product from '../models/Product.js';
import Cart from '../models/Cart.js';
import * as dbHandler from './db-handler.js';
import bcrypt from 'bcryptjs';

describe('Cart API', () => {
  let userId;
  let userToken;
  let productId;
  let product;

  const testUser = {
    name: 'Cart Test User',
    email: 'cartuser@example.com',
    password: 'password123',
    role: 'customer'
  };

  const testProduct = {
    name: 'Test Product',
    slug: 'test-product',
    description: 'Test Description',
    price: 100,
    stock: 'in',
    images: [{ url: 'http://example.com/image.jpg', alt: 'Test Image' }],
    brand: 'Test Brand',
    category: 'Test Category'
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
    // Create user
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(testUser.password, salt);
    
    const user = await User.create({
      name: testUser.name,
      email: testUser.email,
      passwordHash,
      role: testUser.role
    });
    userId = user._id;

    // Login user. Auth is cookie-based now: the app sets an httpOnly accessToken
    // cookie rather than returning it in the body. Extract it from Set-Cookie and
    // send it as a Bearer token (which also exempts these writes from CSRF).
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: testUser.email,
        password: testUser.password
      });
    const accessCookie = (loginRes.headers['set-cookie'] || [])
      .find((c) => c.startsWith('accessToken='));
    userToken = accessCookie
      ? accessCookie.split(';')[0].slice('accessToken='.length)
      : loginRes.body.accessToken;

    // Create product
    product = await Product.create(testProduct);
    productId = product._id;
  });

  describe('GET /cart', () => {
    it('should return empty cart for new user', async () => {
      const res = await request(app)
        .get('/api/v1/cart')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.cart.items).toHaveLength(0);
    });

    it('should return cart with items', async () => {
      // Add item to cart directly
      await Cart.create({
        user: userId,
        items: [{
          product: productId,
          quantity: 2,
          price: product.price
        }]
      });

      const res = await request(app)
        .get('/api/v1/cart')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.cart.items).toHaveLength(1);
      expect(res.body.cart.items[0].quantity).toBe(2);
      expect(res.body.cart.items[0].product._id.toString()).toBe(productId.toString());
    });
  });

  describe('POST /cart/add', () => {
    it('should add item to cart', async () => {
      const res = await request(app)
        .post('/api/v1/cart/add')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          productId: productId,
          quantity: 2
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.cart.items).toHaveLength(1);
      expect(res.body.cart.items[0].quantity).toBe(2);
    });

    it('should increment quantity if item already exists', async () => {
      // First add
      await request(app)
        .post('/api/v1/cart/add')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          productId: productId,
          quantity: 2
        });

      // Second add
      const res = await request(app)
        .post('/api/v1/cart/add')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          productId: productId,
          quantity: 3
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.cart.items).toHaveLength(1);
      expect(res.body.cart.items[0].quantity).toBe(5);
    });

    it('should fail if product is out of stock', async () => {
      await Product.findByIdAndUpdate(productId, { stock: 'out' });

      const res = await request(app)
        .post('/api/v1/cart/add')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          productId: productId,
          quantity: 1
        })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('out of stock');

      await Product.findByIdAndUpdate(productId, { stock: 'in' });
    });

    it('should fail if product does not exist', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .post('/api/v1/cart/add')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          productId: fakeId,
          quantity: 1
        })
        .expect(404);

      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /cart/merge', () => {
    const sessionId = 'sess_test_guest_123';

    it('should require authentication', async () => {
      // A Bearer header satisfies the CSRF exemption; an invalid token means
      // optionalAuth leaves req.user unset, so the handler's 401 branch runs.
      await request(app)
        .post('/api/v1/cart/merge')
        .set('Authorization', 'Bearer invalid.token.value')
        .set('x-session-id', sessionId)
        .expect(401);
    });

    it('should merge a guest cart into an empty user cart', async () => {
      await Cart.create({
        sessionId,
        isGuest: true,
        items: [{ product: productId, quantity: 2, price: product.price }],
      });

      const res = await request(app)
        .post('/api/v1/cart/merge')
        .set('Authorization', `Bearer ${userToken}`)
        .set('x-session-id', sessionId)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.cart.items).toHaveLength(1);
      expect(res.body.cart.items[0].quantity).toBe(2);
      expect(res.body.cart.user.toString()).toBe(userId.toString());

      // Guest cart is consumed so a later guest GET starts fresh and we don't double-merge.
      const guestCart = await Cart.findOne({ sessionId });
      expect(guestCart).toBeNull();
    });

    it('should sum quantities when the product already exists in the user cart', async () => {
      await Cart.create({
        user: userId,
        items: [{ product: productId, quantity: 1, price: product.price }],
      });
      await Cart.create({
        sessionId,
        isGuest: true,
        items: [{ product: productId, quantity: 3, price: product.price }],
      });

      const res = await request(app)
        .post('/api/v1/cart/merge')
        .set('Authorization', `Bearer ${userToken}`)
        .set('x-session-id', sessionId)
        .expect(200);

      expect(res.body.cart.items).toHaveLength(1);
      expect(res.body.cart.items[0].quantity).toBe(4);
    });

    it('should be idempotent — a second merge does not double the quantities', async () => {
      await Cart.create({
        sessionId,
        isGuest: true,
        items: [{ product: productId, quantity: 2, price: product.price }],
      });

      await request(app)
        .post('/api/v1/cart/merge')
        .set('Authorization', `Bearer ${userToken}`)
        .set('x-session-id', sessionId)
        .expect(200);

      const res = await request(app)
        .post('/api/v1/cart/merge')
        .set('Authorization', `Bearer ${userToken}`)
        .set('x-session-id', sessionId)
        .expect(200);

      expect(res.body.cart.items).toHaveLength(1);
      expect(res.body.cart.items[0].quantity).toBe(2);
    });
  });

  describe('PUT /cart/update/:productId', () => {
    beforeEach(async () => {
      await request(app)
        .post('/api/v1/cart/add')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          productId: productId,
          quantity: 2
        });
    });

    it('should update item quantity', async () => {
      const res = await request(app)
        .put(`/api/v1/cart/update/${productId}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          quantity: 5
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      const updatedItem = res.body.cart.items.find(item => item.product._id === productId.toString());
      expect(updatedItem.quantity).toBe(5);
    });

    it('should fail if product is out of stock', async () => {
      await Product.findByIdAndUpdate(productId, { stock: 'out' });

      const res = await request(app)
        .put(`/api/v1/cart/update/${productId}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          quantity: 5
        })
        .expect(400);

      expect(res.body.success).toBe(false);

      await Product.findByIdAndUpdate(productId, { stock: 'in' });
    });
  });

  describe('DELETE /cart/remove/:productId', () => {
    beforeEach(async () => {
      await request(app)
        .post('/api/v1/cart/add')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          productId: productId,
          quantity: 2
        });
    });

    it('should remove item from cart', async () => {
      const res = await request(app)
        .delete(`/api/v1/cart/remove/${productId}`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.cart.items).toHaveLength(0);
    });
  });

  describe('DELETE /cart/clear', () => {
    beforeEach(async () => {
      await request(app)
        .post('/api/v1/cart/add')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          productId: productId,
          quantity: 2
        });
    });

    it('should clear all items from cart', async () => {
      const res = await request(app)
        .delete('/api/v1/cart/clear')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.cart.items).toHaveLength(0);
    });
  });
});
