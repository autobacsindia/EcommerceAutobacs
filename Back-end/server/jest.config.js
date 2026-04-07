export default {
  testTimeout: 300000,
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/tests/setupEnv.js'],
  transform: {},
  // No moduleNameMapper needed: Jest with --experimental-vm-modules resolves
  // ESM imports natively. Adding a .js stripper breaks .cjs internal shims.
  testMatch: ['**/tests/**/*.test.js', '**/?(*.)+(spec|test).js'],
  verbose: true,
  forceExit: true,
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'controllers/**/*.js',
    'middleware/uploadMiddleware.js',
    'models/**/*.js',
    'routes/**/*.js',
    'services/**/*.js',
    '!**/node_modules/**',
    '!**/vendor/**',
    '!**/tests/**',
  ],
  coverageReporters: ['text', 'lcov', 'clover', 'html'],
  // Coverage thresholds — regression guard.
  // Updated to enforce 60%+ coverage across the codebase.
  // Per-file floors lock in coverage for critical files.
  coverageThreshold: {
    global: {
      lines: 60,
      functions: 60,
      branches: 50,
      statements: 60,
    },
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
