import request from 'supertest';
import { jest } from '@jest/globals';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import User from '../models/User.js';
import Product from '../models/Product.js';
import Order from '../models/Order.js';
import Cart from '../models/Cart.js';
import * as dbHandler from './db-handler.js';
import bcrypt from 'bcryptjs';

// Increase timeout for this comprehensive test
jest.setTimeout(60000);

describe('E2E User Journey Integration Test', () => {
  let userToken;
  let adminToken;
  let userId;
  let productId;
  
  const testUser = {
    name: 'Journey User',
    email: 'journey@example.com',
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
    name: 'Journey Product',
    description: 'A product for testing the user journey',
    price: 1000,
    categories: ['65e6d6d6d6d6d6d6d6d6d6d6'], // Dummy ObjectId
    stock: 10,
    isActive: true,
    images: [{ url: 'http://example.com/image.jpg', alt: 'Test Image' }],
    specifications: [{ name: 'Spec1', value: 'Value1' }]
  };

  beforeAll(async () => {
    await dbHandler.connect();
  });

  afterAll(async () => {
    await dbHandler.closeDatabase();
    // Shutdown services
    if (cronService && typeof cronService.shutdown === 'function') {
      cronService.shutdown();
    }
    if (adaptiveThrottlingService && typeof adaptiveThrottlingService.shutdown === 'function') {
      adaptiveThrottlingService.shutdown();
    }
  });

  // Clean up after each test if needed, but for a journey we might want state to persist?
  // No, let's keep it clean and set up fresh for the journey.
  // Actually, let's make the tests sequential steps of the journey.
  // So we don't clear DB between tests in this describe block?
  // That's risky if one fails.
  // Better: One big test or nested describes sharing state?
  // Let's use nested describes but keep the state (DB) throughout the suite?
  // Or better: Re-create the state in beforeEach but that's slow.
  // Let's do a single long test case for the journey, or split it but rely on state.
  // Relying on state between tests is bad practice but acceptable for a "Journey" test suite.
  
  // Actually, standard practice: clean DB beforeAll, and let tests build on each other?
  // Or clean DB afterAll.
  // Let's try to make each step verify its part, and subsequent steps rely on previous steps' outcome.
  // To make it robust, we can put the whole journey in one test function? No, hard to debug.
  
  // I will use `beforeAll` to set up the initial state (clean DB), and then run steps.
  // I will NOT use `afterEach` to clear DB. I will clear DB in `afterAll`.

  it('Step 1: Admin setup - Create Product', async () => {
    // 1. Create Admin
    const salt = await bcrypt.genSalt(10);
    const hashedAdminPassword = await bcrypt.hash(adminUser.password, salt);
    const admin = await User.create({
      ...adminUser,
      passwordHash: hashedAdminPassword
    });
    
    // Login Admin
    const loginRes = await request(app)
      .post('/auth/login')
      .send({
        email: adminUser.email,
        password: adminUser.password
      });
    adminToken = loginRes.body.accessToken;

    // 2. Create Product
    const product = await Product.create({
        ...testProduct
    });
    productId = product._id;
    
    expect(productId).toBeDefined();
  });

  it('Step 2: User Registration and Login', async () => {
    // Register
    const registerRes = await request(app)
      .post('/auth/register')
      .send(testUser);
    
    expect(registerRes.statusCode).toBe(201);
    expect(registerRes.body.success).toBe(true);
    
    // Login
    const loginRes = await request(app)
      .post('/auth/login')
      .send({
        email: testUser.email,
        password: testUser.password
      });
      
    expect(loginRes.statusCode).toBe(200);
    userToken = loginRes.body.accessToken;
    userId = loginRes.body.user.id;
    expect(userToken).toBeDefined();
  });

  it('Step 3: User searches for product', async () => {
    const res = await request(app)
      .get(`/products?search=${testProduct.name}`)
      // .set('Authorization', `Bearer ${userToken}`) // Public route
      
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    // Verify product is in results
    // The structure is { success: true, count: N, products: [...] }
    const found = res.body.products.some(p => p._id === productId.toString());
    expect(found).toBe(true);
  });

  it('Step 4: Add to Cart', async () => {
    // Verify product exists before adding
    const productCheck = await Product.findById(productId);
    if (!productCheck) console.error('Product missing in DB before cart add');

    const res = await request(app)
      .post('/cart/add')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        productId: productId,
        quantity: 2
      });
      
    if (res.statusCode !== 200) {
        console.log('Step 4 Failed Response:', JSON.stringify(res.body, null, 2));
        console.log('Using Product ID:', productId);
        console.log('User Token:', userToken ? 'Present' : 'Missing');
    }

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.cart.items).toHaveLength(1);
    expect(res.body.cart.items[0].product._id.toString()).toBe(productId.toString());
    expect(res.body.cart.items[0].quantity).toBe(2);
  });

  it('Step 5: Place Order (Checkout)', async () => {
    const orderData = {
      items: [
        {
          product: productId,
          quantity: 2,
          price: testProduct.price
        }
      ],
      shippingAddress: {
        fullName: 'Test User',
        phone: '1234567890',
        addressLine1: '123 Test St',
        city: 'Test City',
        state: 'Test State',
        postalCode: '123456',
        country: 'Test Country'
      },
      paymentMethod: 'cod', // Cash on Delivery for simplicity
      totalAmount: testProduct.price * 2
    };

    const res = await request(app)
      .post('/orders')
      .set('Authorization', `Bearer ${userToken}`)
      .send(orderData);

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.order).toBeDefined();
    expect(res.body.order.status).toBe('pending');
  });

  it('Step 6: Verify Stock Deduction', async () => {
    const product = await Product.findById(productId);
    expect(product.stock).toBe(testProduct.stock - 2);
  });
});
