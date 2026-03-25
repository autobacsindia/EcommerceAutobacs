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
  // Global floor is set to current measured baseline so it can only go up.
  // Per-file floors lock in coverage for the three files our test suite
  // directly targets; lower these values ONLY by adding replacement tests.
  coverageThreshold: {
    global: {
      lines: 10,
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
  },
};
