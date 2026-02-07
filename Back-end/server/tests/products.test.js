import request from 'supertest';
import mongoose from 'mongoose';
import { app } from '../app.js';
import Product from '../models/Product.js';
import User from '../models/User.js';
import * as dbHandler from './db-handler.js';
import bcrypt from 'bcryptjs';

describe('Products API', () => {
  let adminId;
  let adminToken;
  let userId;
  let userToken;
  let productId;

  const testAdmin = {
    name: 'Admin User',
    email: 'admin@example.com',
    password: 'password123',
    role: 'admin'
  };

  const testUser = {
    name: 'Regular User',
    email: 'user@example.com',
    password: 'password123',
    role: 'customer'
  };

  const testProduct = {
    name: 'Test Product',
    description: 'Test Description',
    price: 100,
    stock: 10,
    images: [{ url: 'http://example.com/image.jpg', alt: 'Test Image' }],
    brand: 'Test Brand'
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
    // Create admin user
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
    const adminLoginRes = await request(app)
      .post('/auth/login')
      .send({
        email: testAdmin.email,
        password: testAdmin.password
      });
    adminToken = adminLoginRes.body.accessToken;

    // Create regular user
    const user = await User.create({
      name: testUser.name,
      email: testUser.email,
      passwordHash, // reuse hash
      role: testUser.role
    });
    userId = user._id;

    // Login user
    const userLoginRes = await request(app)
      .post('/auth/login')
      .send({
        email: testUser.email,
        password: testUser.password
      });
    userToken = userLoginRes.body.accessToken;

    // Create test product
    const product = await Product.create(testProduct);
    productId = product._id;
  });

  describe('GET /products', () => {
    it('should get all products', async () => {
      const res = await request(app)
        .get('/products')
        .expect(200);
      
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.products)).toBe(true);
      expect(res.body.products.length).toBeGreaterThan(0);
    });

    it('should filter products by search query', async () => {
      const res = await request(app)
        .get('/products')
        .query({ search: 'Test' })
        .expect(200);
      
      expect(res.body.success).toBe(true);
      expect(res.body.products.length).toBeGreaterThan(0);
      expect(res.body.products[0].name).toContain('Test');
    });
  });

  describe('GET /products/:id', () => {
    it('should get product by id', async () => {
      const res = await request(app)
        .get(`/products/${productId}`)
        .expect(200);
      
      expect(res.body.success).toBe(true);
      expect(res.body.product._id).toBe(productId.toString());
    });

    it('should return 404 for non-existent product', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .get(`/products/${fakeId}`)
        .expect(404);
      
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /products', () => {
    it('should create product as admin', async () => {
      const newProduct = {
        name: 'New Product',
        description: 'New Description',
        price: 200,
        stock: 20,
        images: [{ url: 'http://example.com/new.jpg', alt: 'New Image' }],
        brand: 'New Brand',
        category: 'Test Category'
      };

      const res = await request(app)
        .post('/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(newProduct)
        .expect(201);
      
      expect(res.body.success).toBe(true);
      expect(res.body.product.name).toBe(newProduct.name);
    });

    it('should fail to create product as regular user', async () => {
      const newProduct = {
        name: 'User Product',
        description: 'Description',
        price: 100,
        stock: 10,
        images: [{ url: 'http://example.com/img.jpg' }]
      };

      await request(app)
        .post('/products')
        .set('Authorization', `Bearer ${userToken}`)
        .send(newProduct)
        .expect(403);
    });
  });

  describe('PUT /products/:id', () => {
    it('should update product as admin', async () => {
      const res = await request(app)
        .put(`/products/${productId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ price: 150 })
        .expect(200);
      
      expect(res.body.success).toBe(true);
      expect(res.body.product.price).toBe(150);
    });
  });

  describe('DELETE /products/:id', () => {
    it('should delete product as admin', async () => {
      const res = await request(app)
        .delete(`/products/${productId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      
      expect(res.body.success).toBe(true);
      
      // Verify deletion (soft delete)
      const getRes = await request(app)
        .get(`/products/${productId}`)
        .expect(200);
      
      expect(getRes.body.product.isActive).toBe(false);
    });
  });
});
