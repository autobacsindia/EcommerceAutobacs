import request from 'supertest';
import mongoose from 'mongoose';
import { app } from '../app.js';
import Product from '../models/Product.js';
import Category from '../models/Category.js';
import User from '../models/User.js';
import * as dbHandler from './db-handler.js';
import bcrypt from 'bcryptjs';
import categoryMappingService from '../services/categoryMappingService.js';

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
    stock: 'in',
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
        stock: 'in',
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
        stock: 'in',
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

    it('should update product with multiple categories and tags', async () => {
      // Create categories
      const cat1 = await Category.create({ name: 'Update Cat 1', slug: 'update-cat-1' });
      const cat2 = await Category.create({ name: 'Update Cat 2', slug: 'update-cat-2' });

      const updateData = {
        categories: [cat1._id, cat2._id],
        tags: ['tag1', 'tag2', 'tag3']
      };

      const res = await request(app)
        .put(`/products/${productId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(updateData)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.product.categories).toHaveLength(2);
      expect(res.body.product.tags).toHaveLength(3);
      expect(res.body.product.tags).toContain('tag1');
      
      // Verify persistence
      const product = await Product.findById(productId);
      expect(product.categories).toHaveLength(2);
      expect(product.tags).toHaveLength(3);
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

  describe('Advanced Filtering & Sorting', () => {
    beforeEach(async () => {
      // Create categories
      const electronics = await Category.create({
        name: 'Electronics',
        slug: 'electronics'
      });
      const books = await Category.create({
        name: 'Books',
        slug: 'books'
      });

      // Force refresh of category mapping service
      categoryMappingService.initialized = false;
      categoryMappingService.categoryCache.clear();
      await categoryMappingService.initialize();

      // Seed additional products
      await Product.create([
        {
          name: 'Electronics A',
          description: 'Desc A',
          price: 50,
          stock: 'in',
          categories: [electronics._id],
          brand: 'Sony',
          images: [{ url: 'http://example.com/a.jpg' }]
        },
        {
          name: 'Electronics B',
          description: 'Desc B',
          price: 150,
          stock: 'in',
          categories: [electronics._id],
          brand: 'Samsung',
          images: [{ url: 'http://example.com/b.jpg' }]
        },
        {
          name: 'Book C',
          description: 'Desc C',
          price: 200,
          stock: 'in',
          categories: [books._id],
          brand: 'Penguin',
          images: [{ url: 'http://example.com/c.jpg' }]
        }
      ]);
    });

    it('should filter by category', async () => {
      const res = await request(app)
        .get('/products')
        .query({ category: 'Electronics' })
        .expect(200);
      
      expect(res.body.success).toBe(true);
      const names = res.body.products.map(p => p.name);
      expect(names).toContain('Electronics A');
      expect(names).toContain('Electronics B');
      expect(names).not.toContain('Book C');
    });

    it('should filter by brand', async () => {
      const res = await request(app)
        .get('/products')
        .query({ brand: 'Samsung' })
        .expect(200);
      
      expect(res.body.success).toBe(true);
      const names = res.body.products.map(p => p.name);
      expect(names).toContain('Electronics B');
      expect(names).not.toContain('Electronics A');
    });

    it('should filter by price range', async () => {
      const res = await request(app)
        .get('/products')
        .query({ minPrice: 100, maxPrice: 180 })
        .expect(200);
      
      expect(res.body.success).toBe(true);
      const names = res.body.products.map(p => p.name);
      expect(names).toContain('Electronics B');
      expect(names).not.toContain('Electronics A');
      expect(names).not.toContain('Book C');
    });

    it('should sort by price ascending', async () => {
      const res = await request(app)
        .get('/products')
        .query({ sortBy: 'price', order: 'asc' })
        .expect(200);
      
      expect(res.body.success).toBe(true);
      const prices = res.body.products.map(p => p.price);
      const sortedPrices = [...prices].sort((a, b) => a - b);
      expect(prices).toEqual(sortedPrices);
    });
  });

  describe('Product Validation', () => {
    it('should return 400 when creating product without required fields', async () => {
       const invalidProduct = {
        description: 'No Name'
      };

      await request(app)
        .post('/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(invalidProduct)
        .expect(400);
    });
  });
});
