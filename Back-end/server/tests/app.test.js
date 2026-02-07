import request from 'supertest';
import { app } from '../app.js';
import mongoose from 'mongoose';

describe('App Root Endpoint', () => {
  it('should return 200 and welcome message', async () => {
    const res = await request(app).get('/');
    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Autobacs India API is running');
  });
});

afterAll(async () => {
  await mongoose.connection.close();
});
