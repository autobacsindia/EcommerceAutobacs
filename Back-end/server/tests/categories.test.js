import request from 'supertest';
import mongoose from 'mongoose';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import User from '../models/User.js';
import Category from '../models/Category.js';
import Product from '../models/Product.js';
import * as dbHandler from './db-handler.js';
import bcrypt from 'bcryptjs';

const BASE = '/api/v1';

/** Extract the XSRF-TOKEN value from a set-cookie header array. */
function extractCsrfFromSetCookie(setCookieHeader = []) {
  const xsrfCookie = setCookieHeader.find((c) => c.startsWith('XSRF-TOKEN='));
  if (!xsrfCookie) return '';
  return xsrfCookie.split(';')[0].split('=')[1];
}

describe('Categories API', () => {
  // Cookie-jar agent so the httpOnly accessToken + XSRF cookies survive requests.
  let agent;
  let csrfToken;
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

    await User.create({
      name: testAdmin.name,
      email: testAdmin.email,
      passwordHash,
      role: testAdmin.role
    });

    // Persistent agent: GET /ping seeds the XSRF-TOKEN cookie, then login sets
    // the httpOnly accessToken cookie. Auth is cookie-based (not bearer tokens).
    agent = request.agent(app);
    await agent.get('/ping');

    const loginRes = await agent
      .post(`${BASE}/auth/login`)
      .send({ email: testAdmin.email, password: testAdmin.password });

    // Capture the XSRF-TOKEN the agent will actually send (login may rotate it).
    // Prefer the login set-cookie, then fall back to the agent's cookie jar.
    csrfToken = extractCsrfFromSetCookie(loginRes.headers['set-cookie'] || []);
    if (!csrfToken && agent.jar?.getCookiesSync) {
      const jarCookie = agent.jar.getCookiesSync('http://127.0.0.1').find((c) => c.key === 'XSRF-TOKEN');
      csrfToken = jarCookie ? jarCookie.value : '';
    }

    // Create category
    category = await Category.create(testCategory);
    categoryId = category._id;
  });

  describe('GET /categories', () => {
    it('should return all active categories', async () => {
      const res = await request(app)
        .get(`${BASE}/categories`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.categories).toHaveLength(1);
      expect(res.body.categories[0].name).toBe(testCategory.name);
    });
  });

  describe('GET /categories/:id', () => {
    it('should return category by id', async () => {
      const res = await request(app)
        .get(`${BASE}/categories/${categoryId}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.category.name).toBe(testCategory.name);
    });

    it('should return 404 for non-existent id', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .get(`${BASE}/categories/${fakeId}`)
        .expect(404);

      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /categories/slug/:slug', () => {
    it('should return category by slug', async () => {
      const res = await request(app)
        .get(`${BASE}/categories/slug/${testCategory.slug}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.category.name).toBe(testCategory.name);
    });

    it('should handle special slug transformations', async () => {
      await Category.create({ name: 'Body Kits', slug: 'body-kits', isActive: true });

      const res = await request(app)
        .get(`${BASE}/categories/slug/bodykit`)
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

      const res = await agent
        .post(`${BASE}/categories`)
        .set('X-XSRF-TOKEN', csrfToken)
        .send(newCategory)
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.category.name).toBe(newCategory.name);
    });

    it('should fail without authentication', async () => {
      await request(app)
        .post(`${BASE}/categories`)
        .set('Authorization', 'Bearer invalid_token')
        .send({ name: 'Fail Category', slug: 'fail-category' })
        .expect(401);
    });
  });

  describe('PUT /categories/:id', () => {
    it('should update category as admin', async () => {
      const res = await agent
        .put(`${BASE}/categories/${categoryId}`)
        .set('X-XSRF-TOKEN', csrfToken)
        .send({ name: 'Updated Category' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.category.name).toBe('Updated Category');
    });
  });

  describe('Featured flag', () => {
    it('creates a category with isFeatured=true', async () => {
      const res = await agent
        .post(`${BASE}/categories`)
        .set('X-XSRF-TOKEN', csrfToken)
        .send({ name: 'Featured Hub', slug: 'featured-hub', isFeatured: true })
        .expect(201);

      expect(res.body.category.isFeatured).toBe(true);
    });

    it('toggles isFeatured via PATCH /:id/feature', async () => {
      const cat = await Category.create({ name: 'Toggle Hub', slug: 'toggle-hub', isFeatured: false });

      const on = await agent
        .patch(`${BASE}/categories/${cat._id}/feature`)
        .set('X-XSRF-TOKEN', csrfToken)
        .expect(200);
      expect(on.body.isFeatured).toBe(true);
      expect((await Category.findById(cat._id)).isFeatured).toBe(true);

      const off = await agent
        .patch(`${BASE}/categories/${cat._id}/feature`)
        .set('X-XSRF-TOKEN', csrfToken)
        .expect(200);
      expect(off.body.isFeatured).toBe(false);
    });

    it('rejects the feature toggle without authentication', async () => {
      const cat = await Category.create({ name: 'NoAuth Hub', slug: 'noauth-hub' });
      await request(app)
        .patch(`${BASE}/categories/${cat._id}/feature`)
        .set('Authorization', 'Bearer invalid_token')
        .expect(401);
    });
  });

  describe('DELETE /categories/:id', () => {
    it('should soft delete category as admin', async () => {
      const res = await agent
        .delete(`${BASE}/categories/${categoryId}`)
        .set('X-XSRF-TOKEN', csrfToken)
        .expect(200);

      expect(res.body.success).toBe(true);

      const catInDb = await Category.findById(categoryId);
      expect(catInDb.isActive).toBe(false);
    });

    it('should refuse to delete a category that still has active subcategories', async () => {
      await Category.create({
        name: 'Child Category',
        slug: 'child-category',
        parent: categoryId,
        isActive: true,
      });

      const res = await agent
        .delete(`${BASE}/categories/${categoryId}`)
        .set('X-XSRF-TOKEN', csrfToken)
        .expect(409);

      expect(res.body.success).toBe(false);
      expect(res.body.details.childCount).toBe(1);
      // Ensure it was NOT soft-deleted
      const catInDb = await Category.findById(categoryId);
      expect(catInDb.isActive).toBe(true);
    });

    it('should refuse to delete a category that still has linked products', async () => {
      await Product.create({
        name: 'Linked Product',
        description: 'A product in the category',
        price: 100,
        slug: 'linked-product',
        categories: [categoryId],
      });

      const res = await agent
        .delete(`${BASE}/categories/${categoryId}`)
        .set('X-XSRF-TOKEN', csrfToken)
        .expect(409);

      expect(res.body.success).toBe(false);
      expect(res.body.details.productCount).toBe(1);
    });
  });

  describe('GET /categories/admin/all', () => {
    it('should require authentication', async () => {
      await request(app).get(`${BASE}/categories/admin/all`).expect(401);
    });

    it('should return inactive categories too', async () => {
      await Category.create({ name: 'Hidden Category', slug: 'hidden-category', isActive: false });

      const res = await agent
        .get(`${BASE}/categories/admin/all`)
        .expect(200);

      const slugs = res.body.categories.map((c) => c.slug);
      expect(slugs).toContain('hidden-category'); // inactive one is present
      expect(slugs).toContain(testCategory.slug);
    });

    it('omits product counts when counts=false, but still returns inactive categories', async () => {
      // The admin product/parent pickers use this: they need the full tree
      // (inactive included, no 200-item cap) but never render count badges, so
      // they skip the distinct-aggregation over every active product.
      await Category.create({ name: 'Hidden Category', slug: 'hidden-category', isActive: false });
      await Product.create({ name: 'P-1', description: 'd', price: 10, slug: 'p-1', categories: [categoryId] });

      const res = await agent
        .get(`${BASE}/categories/admin/all?counts=false`)
        .expect(200);

      const slugs = res.body.categories.map((c) => c.slug);
      expect(slugs).toContain('hidden-category');

      for (const c of res.body.categories) {
        expect(c.productCount).toBeUndefined();
        expect(c.totalProductCount).toBeUndefined();
      }
    });

    it('still includes counts unless counts=false is passed explicitly', async () => {
      await Product.create({ name: 'P-1', description: 'd', price: 10, slug: 'p-1', categories: [categoryId] });

      const res = await agent.get(`${BASE}/categories/admin/all?counts=true`).expect(200);
      const parent = res.body.categories.find((c) => String(c._id) === String(categoryId));
      expect(parent.productCount).toBe(1);
    });

    it('should include direct and subtree product counts', async () => {
      // Parent (testCategory) ← child; products split across both levels.
      const child = await Category.create({ name: 'Child Cat', slug: 'child-cat', parent: categoryId });
      await Product.create({ name: 'P-parent', description: 'd', price: 10, slug: 'p-parent', categories: [categoryId] });
      await Product.create({ name: 'P-child', description: 'd', price: 10, slug: 'p-child', categories: [child._id] });
      // Inactive product must not be counted (active-only semantics).
      await Product.create({ name: 'P-inactive', description: 'd', price: 10, slug: 'p-inactive', categories: [child._id], isActive: false });

      const res = await agent.get(`${BASE}/categories/admin/all`).expect(200);
      const byId = new Map(res.body.categories.map((c) => [String(c._id), c]));

      const parent = byId.get(String(categoryId));
      const childRow = byId.get(String(child._id));

      expect(parent.productCount).toBe(1);       // one product directly on the parent
      expect(parent.totalProductCount).toBe(2);  // parent + child (active only)
      expect(childRow.productCount).toBe(1);
      expect(childRow.totalProductCount).toBe(1);
    });

    it('counts a product tagged with BOTH a parent and its child only once in the subtree', async () => {
      // Regression: a summed rollup double-counted multi-tagged products (the
      // storefront read 132 vs the listing's 120). The distinct union must count
      // this product once → parent subtree = 1, not 2.
      const child = await Category.create({ name: 'Dedup Child', slug: 'dedup-child', parent: categoryId });
      await Product.create({
        name: 'P-both', description: 'd', price: 10, slug: 'p-both',
        categories: [categoryId, child._id], // tagged with hub AND its descendant
      });

      const res = await agent.get(`${BASE}/categories/admin/all`).expect(200);
      const byId = new Map(res.body.categories.map((c) => [String(c._id), c]));

      const parent = byId.get(String(categoryId));
      const childRow = byId.get(String(child._id));

      expect(parent.productCount).toBe(1);       // direct on the parent
      expect(childRow.productCount).toBe(1);      // direct on the child
      expect(parent.totalProductCount).toBe(1);   // union, NOT 1 + 1
      expect(childRow.totalProductCount).toBe(1);
    });
  });

  describe('Category integrity rules', () => {
    it('should reject a duplicate slug with 409', async () => {
      const res = await agent
        .post(`${BASE}/categories`)
        .set('X-XSRF-TOKEN', csrfToken)
        .send({ name: 'Another Name', slug: testCategory.slug })
        .expect(409);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/Duplicate value/i);
    });

    it('should reject setting a category as its own parent', async () => {
      const res = await agent
        .put(`${BASE}/categories/${categoryId}`)
        .set('X-XSRF-TOKEN', csrfToken)
        .send({ parent: String(categoryId) })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it('should reject a circular parent assignment', async () => {
      // `category` (A) is top-level. Make B a child of A, then try to make A a child of B.
      // Under the 2-level rule this is rejected because B (a subcategory) cannot be a parent,
      // which also prevents the cycle. Any of these rejection messages is acceptable.
      const b = await Category.create({ name: 'B Category', slug: 'b-category', parent: categoryId });

      const res = await agent
        .put(`${BASE}/categories/${categoryId}`)
        .set('X-XSRF-TOKEN', csrfToken)
        .send({ parent: String(b._id) })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/circular|two levels|subcategor/i);
    });

    it('should reject a non-existent parent', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await agent
        .put(`${BASE}/categories/${categoryId}`)
        .set('X-XSRF-TOKEN', csrfToken)
        .send({ parent: String(fakeId) })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/Parent category not found/i);
    });

    it('should reject creating a 3rd-level category (2-level limit)', async () => {
      // category (A) is top-level. Make B a child of A, then try to create C under B.
      const b = await Category.create({ name: 'Sub B', slug: 'sub-b', parent: categoryId });

      const res = await agent
        .post(`${BASE}/categories`)
        .set('X-XSRF-TOKEN', csrfToken)
        .send({ name: 'Deep C', slug: 'deep-c', parent: String(b._id) })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/two levels|top-level/i);
    });
  });
});
