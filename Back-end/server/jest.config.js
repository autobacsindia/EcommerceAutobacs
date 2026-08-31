export default {
  testTimeout: 300000,
  testEnvironment: 'node',
  
  // Env must be set before any module (e.g. the razorpayService singleton) is imported,
  // so it runs in setupFiles — ahead of the test framework and the suite's imports.
  setupFiles: ['<rootDir>/tests/setupEnv.js'],

  // Setup files (run before each test file)
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],

  // One in-memory MongoDB for the entire run, started before any worker is forked and
  // stopped after the last one exits. Each test file connects to it under its own
  // database name (tests/setup.js), which keeps per-suite isolation without paying a
  // ~2.5s `mongod` spawn per suite.
  globalSetup: '<rootDir>/tests/globalSetup.js',
  globalTeardown: '<rootDir>/tests/globalTeardown.js',
  
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
  
  // NOTE: `detectOpenHandles` is deliberately NOT set here.
  //
  // Jest's shouldRunInBand() short-circuits on it — `if (runInBand || detectOpenHandles)
  // return true` — because it cannot trace handles inside forked workers. Setting it in
  // the config therefore forced all ~167 suites through a single worker, serially, on
  // every run. It is available on demand via `npm run test:handles`.
  //
  // `forceExit` below already prevents a leaked handle from hanging the run.

  // Coverage configuration
  //
  // CI (ci.yml + deploy.yml) runs a curated, fast subset via --testPathPatterns
  // (orderStatusService|uploadMiddleware|auth.integration|productImageController|
  // e2e.product-lifecycle). Coverage is therefore scoped to the critical files
  // that subset actually exercises, so the threshold is a real regression guard
  // rather than an unreachable whole-codebase number. Broaden collectCoverageFrom
  // and the thresholds as the curated suite set grows.
  // Coverage is opt-in via `--coverage` (npm run test:coverage, which is what CI runs).
  // It used to be forced on for every run, so a plain `npm test` paid the
  // instrumentation cost for a report nobody was reading.
  coverageDirectory: 'coverage',
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
