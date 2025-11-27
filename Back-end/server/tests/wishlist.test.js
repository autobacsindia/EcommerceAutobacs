import request from 'supertest';
import mongoose from 'mongoose';
import app from '../server.js';
import Wishlist from '../models/Wishlist.js';
import User from '../models/User.js';
import Product from '../models/Product.js';
import bcrypt from 'bcryptjs';

// Mock data
const testUser = {
  name: 'Test User',
  email: 'test@example.com',
  password: 'password123'
};

const testProduct = {
  name: 'Test Product',
  price: 99.99,
  description: 'Test product description',
  category: 'Test Category',
  brand: 'Test Brand',
  stock: 10,
  isActive: true
};

let authToken;
let userId;
let productId;
let wishlistId;

beforeAll(async () => {
  // Connect to database
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/autobacs_test');
  
  // Create test user
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(testUser.password, salt);
  
  const user = await User.create({
    name: testUser.name,
    email: testUser.email,
    passwordHash
  });
  
  userId = user._id;
  
  // Login to get auth token
  const loginRes = await request(app)
    .post('/auth/login')
    .send({
      email: testUser.email,
      password: testUser.password
    });
    
  authToken = loginRes.body.token;
  
  // Create test product
  const product = await Product.create(testProduct);
  productId = product._id;
});

afterAll(async () => {
  // Clean up test data
  await User.deleteMany({ email: testUser.email });
  await Product.deleteMany({ name: testProduct.name });
  await Wishlist.deleteMany({ user: userId });
  await mongoose.connection.close();
});

describe('Wishlist API', () => {
  describe('POST /wishlist', () => {
    it('should create a new wishlist', async () => {
      const res = await request(app)
        .post('/wishlist')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Test Wishlist',
          description: 'Test wishlist description',
          privacy: 'private'
        })
        .expect(201);
        
      expect(res.body.success).toBe(true);
      expect(res.body.wishlist.name).toBe('Test Wishlist');
      expect(res.body.wishlist.user.toString()).toBe(userId.toString());
      
      wishlistId = res.body.wishlist._id;
    });
    
    it('should not create wishlist without name', async () => {
      const res = await request(app)
        .post('/wishlist')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          description: 'Test wishlist description'
        })
        .expect(400);
        
      expect(res.body.success).toBe(false);
    });
  });
  
  describe('GET /wishlist', () => {
    it('should get all user wishlists', async () => {
      const res = await request(app)
        .get('/wishlist')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
        
      expect(res.body.success).toBe(true);
      expect(res.body.wishlists.length).toBe(1);
    });
  });
  
  describe('PUT /wishlist/:id', () => {
    it('should update wishlist details', async () => {
      const res = await request(app)
        .put(`/wishlist/${wishlistId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Updated Wishlist',
          description: 'Updated description'
        })
        .expect(200);
        
      expect(res.body.success).toBe(true);
      expect(res.body.wishlist.name).toBe('Updated Wishlist');
    });
  });
  
  describe('POST /wishlist/:id/items', () => {
    it('should add item to wishlist', async () => {
      const res = await request(app)
        .post(`/wishlist/${wishlistId}/items`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          productId: productId,
          notes: 'Test notes'
        })
        .expect(200);
        
      expect(res.body.success).toBe(true);
      expect(res.body.wishlist.items.length).toBe(1);
    });
    
    it('should not add duplicate item to wishlist', async () => {
      const res = await request(app)
        .post(`/wishlist/${wishlistId}/items`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          productId: productId
        })
        .expect(400);
        
      expect(res.body.success).toBe(false);
    });
  });
  
  describe('POST /wishlist/:id/share', () => {
    it('should make wishlist public', async () => {
      const res = await request(app)
        .post(`/wishlist/${wishlistId}/share`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          isPublic: true
        })
        .expect(200);
        
      expect(res.body.success).toBe(true);
      expect(res.body.wishlist.privacy).toBe('public');
      expect(res.body.shareLink).toBeDefined();
    });
  });
  
  describe('GET /wishlist/:id/export', () => {
    it('should export wishlist as JSON', async () => {
      const res = await request(app)
        .get(`/wishlist/${wishlistId}/export`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
        
      expect(res.body.wishlist).toBeDefined();
      expect(res.body.wishlist.name).toBe('Updated Wishlist');
    });
  });
  
  describe('DELETE /wishlist/:id/items/:productId', () => {
    it('should remove item from wishlist', async () => {
      const res = await request(app)
        .delete(`/wishlist/${wishlistId}/items/${productId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
        
      expect(res.body.success).toBe(true);
      expect(res.body.wishlist.items.length).toBe(0);
    });
  });
  
  describe('DELETE /wishlist/:id', () => {
    it('should delete wishlist', async () => {
      const res = await request(app)
        .delete(`/wishlist/${wishlistId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
        
      expect(res.body.success).toBe(true);
    });
  });
});