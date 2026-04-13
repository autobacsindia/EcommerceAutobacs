export default {
  testTimeout: 300000,
  testEnvironment: 'node',
  
  // Setup files (run before each test file)
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  
  // ESM configuration
  transform: {},
  
  // Test file patterns
  testMatch: [
    '**/tests/**/*.test.js',
    '**/?(*.)+(spec|test).js'
  ],
  
  // Verbosity and exit behavior
  verbose: true,
  forceExit: true,
  
  // Mock isolation (CRITICAL for reliable tests)
  clearMocks: true,      // Clear mock calls between tests
  resetMocks: true,      // Reset mock implementations
  restoreMocks: true,    // Restore original implementations
  
  // Detect open handles (prevent hanging tests)
  detectOpenHandles: true,
  
  // Coverage configuration
  coverageDirectory: 'coverage',
  collectCoverage: true,
  collectCoverageFrom: [
    'controllers/**/*.js',
    'middleware/**/*.js',
    'models/**/*.js',
    'routes/**/*.js',
    'services/**/*.js',
    'utils/**/*.js',
    '!**/node_modules/**',
    '!**/vendor/**',
    '!**/tests/**',
    '!server.js',         // Entry point, hard to test
    '!app.js',            // App configuration, hard to test
  ],
  coverageReporters: ['text', 'lcov', 'clover', 'html'],
  
  // Coverage thresholds — regression guard
  // Current: 55% (being improved)
  // Target: 70%+ for production readiness
  coverageThreshold: {
    global: {
      lines: 55,
      functions: 55,
      branches: 45,
      statements: 55,
    },
    // Critical files require higher coverage
    './controllers/productImageController.js': {
      lines: 65,
    },
    './middleware/uploadMiddleware.js': {
      lines: 70,
    },
    './services/orderStatusService.js': {
      lines: 60,
    },
    './services/razorpayService.js': {
      lines: 70,
    },
    './routes/razorpay.js': {
      lines: 75,
    },
  },
};
