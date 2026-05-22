import { jest } from '@jest/globals';

/**
 * Jest Test Setup - Production Configuration
 *
 * This file runs before each test file.
 * Sets up:
 * - In-memory MongoDB
 * - Global test utilities
 * - Mock cleanup
 * - Error handling
 */

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongoServer;

// ── Global Setup ────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Create in-memory MongoDB
  mongoServer = await MongoMemoryServer.create({
    instance: {
      launchTimeout: 120000, // 2 minutes for slow CI
      port: 0 // Random available port
    },
    binary: {
      version: '7.0.14' // Match production MongoDB version
    }
  });

  const uri = mongoServer.getUri();
  
  // Connect Mongoose
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(uri, {
      maxPoolSize: 10, // Limit connections for tests
      serverSelectionTimeoutMS: 5000
    });
  }

  console.log('[Test] Connected to in-memory MongoDB');
});

// ── Per-Test Cleanup ────────────────────────────────────────────────────────

afterEach(async () => {
  // Clear all collections (not drop, faster)
  if (mongoose.connection.readyState === 1) {
    const collections = mongoose.connection.collections;
    
    await Promise.all(
      Object.values(collections).map(collection => 
        collection.deleteMany({})
      )
    );
  }

  // Clear all mocks
  jest.clearAllMocks();
});

// ── Global Teardown ─────────────────────────────────────────────────────────

afterAll(async () => {
  // Close Mongoose connection
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }

  // Stop in-memory MongoDB
  if (mongoServer) {
    await mongoServer.stop();
  }

  console.log('[Test] In-memory MongoDB stopped');
});

// ── Global Error Handling ───────────────────────────────────────────────────

// Prevent unhandled promise rejections from crashing tests
process.on('unhandledRejection', (error) => {
  console.error('[Test] Unhandled Promise Rejection:', error);
});

// Prevent open handles from hanging tests
process.on('uncaughtException', (error) => {
  console.error('[Test] Uncaught Exception:', error);
});

// ── Global Test Utilities ───────────────────────────────────────────────────

/**
 * Create authenticated request helper
 * 
 * Usage:
 *   const { authenticatedRequest } = global;
 *   const res = await authenticatedRequest(app).get('/api/v1/profile');
 */
global.createTestUser = async (overrides = {}) => {
  const { default: User } = await import('../models/User.js');
  
  const userData = {
    name: 'Test User',
    email: `test${Date.now()}@example.com`,
    password: 'TestPass123!',
    role: 'user',
    ...overrides
  };
  
  return await User.create(userData);
};

/**
 * Generate test auth token
 */
global.generateAuthToken = async (user) => {
  const jwt = await import('jsonwebtoken');
  return jwt.default.sign(
    { userId: user._id },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
};

/**
 * Create authenticated supertest request
 */
global.authenticatedRequest = async (app, user) => {
  const supertest = await import('supertest');
  const token = await global.generateAuthToken(user);
  
  return supertest.default(app)
    .get('/') // Dummy request to get agent
    .set('Authorization', `Bearer ${token}`);
};

// ── Suppress Console in Tests (Optional) ────────────────────────────────────

// Uncomment to suppress console.log in tests (reduces noise)
// global.console = {
//   ...console,
//   log: jest.fn(),
//   debug: jest.fn(),
//   info: jest.fn(),
//   warn: jest.fn(),
// };

// Always keep console.error for debugging test failures
