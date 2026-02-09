export default {
  testEnvironment: 'node',
  transform: {},
  setupFiles: ['<rootDir>/server/tests/setupEnv.js'],
  testTimeout: 300000,
  verbose: true,
  collectCoverage: true,
  collectCoverageFrom: [
    'server/**/*.js',
    '!server/tests/**',
    '!server/node_modules/**',
    '!server/config/**',
    '!server/coverage/**',
    '!**/node_modules/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov']
};
