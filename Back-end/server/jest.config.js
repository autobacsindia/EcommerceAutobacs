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
  //
  // CI (ci.yml + deploy.yml) runs a curated, fast subset via --testPathPatterns
  // (orderStatusService|uploadMiddleware|auth.integration|productImageController|
  // e2e.product-lifecycle). Coverage is therefore scoped to the critical files
  // that subset actually exercises, so the threshold is a real regression guard
  // rather than an unreachable whole-codebase number. Broaden collectCoverageFrom
  // and the thresholds as the curated suite set grows.
  coverageDirectory: 'coverage',
  collectCoverage: true,
  collectCoverageFrom: [
    'controllers/productImageController.js',
    'middleware/uploadMiddleware.js',
    'services/orderStatusService.js',
  ],
  coverageReporters: ['text', 'lcov', 'clover', 'html'],

  // Coverage thresholds — regression guard for the CI-guarded critical files.
  coverageThreshold: {
    global: {
      lines: 55,
      functions: 55,
      branches: 45,
      statements: 55,
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
