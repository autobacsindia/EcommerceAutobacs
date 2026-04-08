
import request from 'supertest';
import { app } from '../app.js';
import User from '../models/User.js';
import bcrypt from 'bcryptjs';
import * as dbHandler from './db-handler.js';

const testUser = {
  name: 'Test User',
  email: 'test@example.com',
  password: 'password123'
};

beforeAll(async () => {
  await dbHandler.connect();
});

afterAll(async () => {
  await dbHandler.closeDatabase();
});

describe('Login Debug', () => {
  it('should return accessToken on login', async () => {
    // Create test user
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(testUser.password, salt);
    
    await User.create({
      name: testUser.name,
      email: testUser.email,
      passwordHash
    });
    
    // Login
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: testUser.email,
        password: testUser.password
      });
      
    console.log('Login Status:', res.statusCode);
    console.log('Login Body:', JSON.stringify(res.body, null, 2));
    
    expect(res.statusCode).toBe(200);
    expect(res.body.accessToken).toBeDefined();
  });
});
