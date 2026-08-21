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
    password: 'SecurePass123!',
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

    // Reading a cart used to INSERT one, so every anonymous visitor who loaded a
    // page touching /cart created a row: 81,492 cart documents in production
    // against 478 that ever held an item, ~2,000/day and no TTL.
    it('does NOT create a cart document when a guest merely reads', async () => {
      const sessionId = 'read-only-guest-session';

      const res = await request(app)
        .get('/api/v1/cart')
        .set('x-session-id', sessionId)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.cart.items).toHaveLength(0);
      expect(await Cart.countDocuments({ sessionId })).toBe(0);
    });

    it('does NOT create a cart document when an authenticated user merely reads', async () => {
      await request(app)
        .get('/api/v1/cart')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(await Cart.countDocuments({ user: userId })).toBe(0);
    });

    it('creates the cart on first add, not on read', async () => {
      const sessionId = 'creates-on-add-session';

      await request(app).get('/api/v1/cart').set('x-session-id', sessionId).expect(200);
      expect(await Cart.countDocuments({ sessionId })).toBe(0);

      // A Bearer header satisfies the CSRF exemption; an invalid token leaves
      // req.user unset so the guest branch runs. Same pattern as the merge tests.
      await request(app)
        .post('/api/v1/cart/add')
        .set('Authorization', 'Bearer invalid.token.value')
        .set('x-session-id', sessionId)
        .send({ productId: productId.toString(), quantity: 1 })
        .expect(200);

      expect(await Cart.countDocuments({ sessionId })).toBe(1);
    });

    // Removing create-on-read opened a race: two concurrent FIRST adds on a fresh
    // session both construct a new Cart, and the loser hits E11000 on the unique
    // partial index. Without the retry in routes/cart.js that surfaced as a 500
    // and the shopper's item vanished.
    it('survives two concurrent first adds without losing an item', async () => {
      const sessionId = 'concurrent-first-add';

      const add = () => request(app)
        .post('/api/v1/cart/add')
        .set('Authorization', 'Bearer invalid.token.value')
        .set('x-session-id', sessionId)
        .send({ productId: productId.toString(), quantity: 1 });

      const [a, b] = await Promise.all([add(), add()]);

      expect(a.status).toBe(200);
      expect(b.status).toBe(200);

      // Exactly one cart, and neither add was dropped.
      expect(await Cart.countDocuments({ sessionId })).toBe(1);
      const cart = await Cart.findOne({ sessionId });
      expect(cart.items).toHaveLength(1);
      expect(cart.items[0].quantity).toBe(2);
    });
  });

  /**
   * Regression tests for the production data-loss bug.
   *
   * Production carried two TTL indexes that were never in models/Cart.js:
   * `recentChanges.createdAt_1` and `recentChanges_1`, both expireAfterSeconds:300.
   * A TTL index over an array of dates expires on the MINIMUM value and deletes
   * the WHOLE document — so a cart that recorded a REMOVED_OUT_OF_STOCK note
   * (routes/cart.js pushes one and saves) was deleted five minutes later, taking
   * the shopper's whole basket with it.
   *
   * These assert the schema's intent: a cart is never expired by anything keyed
   * on recentChanges, and the replacement guest TTL can never touch a user cart.
   */
  describe('cart TTL indexes', () => {
    const indexesOf = () => Cart.schema.indexes();

    it('declares NO TTL index on recentChanges', () => {
      const offenders = indexesOf().filter(([key, opts]) => {
        const keyed = Object.keys(key).some((k) => k.startsWith('recentChanges'));
        return keyed && opts?.expireAfterSeconds != null;
      });
      expect(offenders).toEqual([]);
    });

    it('a cart holding a recentChanges entry survives (no document-level expiry)', async () => {
      const cart = await Cart.create({
        sessionId: 'cart-with-changes',
        items: [{ product: productId, quantity: 1, price: product.price }],
        recentChanges: [{
          type: 'REMOVED_OUT_OF_STOCK',
          productId,
          productName: 'Test Product',
          previousQuantity: 1,
          newQuantity: 0,
          message: 'removed',
          // Older than the 300s the orphan index used, so the old index would
          // have reaped this document.
          createdAt: new Date(Date.now() - 10 * 60 * 1000)
        }]
      });

      const found = await Cart.findById(cart._id);
      expect(found).not.toBeNull();
      expect(found.items).toHaveLength(1);
    });

    it('the guest TTL index is restricted to guest carts only', () => {
      const ttl = indexesOf().find(([, opts]) => opts?.name === 'guest_cart_ttl');
      expect(ttl).toBeDefined();

      const [key, opts] = ttl;
      expect(key).toEqual({ updatedAt: 1 });
      expect(opts.expireAfterSeconds).toBe(30 * 24 * 60 * 60);
      // The clause that makes a logged-in user's cart immune: no sessionId,
      // so the document is not in the index and can never expire.
      expect(opts.partialFilterExpression).toEqual({
        sessionId: { $type: 'string' }
      });
    });

    it('an authenticated user cart is outside the guest TTL partial filter', async () => {
      const cart = await Cart.create({
        user: userId,
        items: [{ product: productId, quantity: 1, price: product.price }]
      });

      // The exact filter the TTL index uses; a user cart must not match it.
      const matched = await Cart.countDocuments({
        _id: cart._id,
        sessionId: { $type: 'string' }
      });
      expect(matched).toBe(0);
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
