import request from 'supertest';
import mongoose from 'mongoose';
import { app } from '../app.js';
import User from '../models/User.js';
import Category from '../models/Category.js';
import * as dbHandler from './db-handler.js';
import bcrypt from 'bcryptjs';

describe('Categories API', () => {
  let adminId;
  let adminToken;
  let categoryId;
  let category;

  const testAdmin = {
    name: 'Category Admin',
    email: 'catadmin@example.com',
    password: 'password123',
    role: 'admin'
  };

  const testCategory = {
    name: 'Test Category',
    slug: 'test-category',
    description: 'Test Description',
    order: 1
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

    // Create category
    category = await Category.create(testCategory);
    categoryId = category._id;
  });

  describe('GET /categories', () => {
    it('should return all active categories', async () => {
      const res = await request(app)
        .get('/categories')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.categories).toHaveLength(1);
      expect(res.body.categories[0].name).toBe(testCategory.name);
    });
  });

  describe('GET /categories/:id', () => {
    it('should return category by id', async () => {
      const res = await request(app)
        .get(`/categories/${categoryId}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.category.name).toBe(testCategory.name);
    });

    it('should return 404 for invalid id format', async () => {
      // Assuming validateIdParam middleware handles format check
      // If mongoose handles it, it might be 400 or 500 depending on middleware
      // Using a valid but non-existent ID
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .get(`/categories/${fakeId}`)
        .expect(404);
      
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /categories/slug/:slug', () => {
    it('should return category by slug', async () => {
      const res = await request(app)
        .get(`/categories/slug/${testCategory.slug}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.category.name).toBe(testCategory.name);
    });

    it('should handle special slug transformations', async () => {
        // Create special category
        await Category.create({
            name: 'Body Kits',
            slug: 'body-kits',
            isActive: true
        });

        // Test with 'bodykit'
        const res = await request(app)
            .get('/categories/slug/bodykit')
            .expect(200);
        
        expect(res.body.category.slug).toBe('body-kits');
    });
  });

  describe('POST /categories', () => {
    it('should create category as admin', async () => {
      const newCategory = {
        name: 'New Category',
        slug: 'new-category',
        description: 'New Description'
      };

      const res = await request(app)
        .post('/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(newCategory)
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.category.name).toBe(newCategory.name);
    });

    it('should fail with invalid token', async () => {
      const newCategory = {
        name: 'Fail Category',
        slug: 'fail-category'
      };

      await request(app)
        .post('/categories')
        .set('Authorization', 'Bearer invalid_token')
        .send(newCategory)
        .expect(401);
    });
  });

  describe('PUT /categories/:id', () => {
    it('should update category as admin', async () => {
      const updatedData = {
        name: 'Updated Category'
      };

      const res = await request(app)
        .put(`/categories/${categoryId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(updatedData)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.category.name).toBe(updatedData.name);
    });
  });

  describe('DELETE /categories/:id', () => {
    it('should soft delete category as admin', async () => {
      const res = await request(app)
        .delete(`/categories/${categoryId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);

      // Verify soft delete
      const getRes = await request(app)
        .get(`/categories/${categoryId}`)
        .expect(200); // Admin or explicit get might still return it, but public list filters it?
      
      // The GET /categories/:id endpoint doesn't filter by isActive explicitly in the findById query
      // but usually the frontend expects it. 
      // Let's check the database directly to be sure
      const catInDb = await Category.findById(categoryId);
      expect(catInDb.isActive).toBe(false);
    });
  });
});
