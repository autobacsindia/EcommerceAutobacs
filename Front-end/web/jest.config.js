/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  testEnvironment: 'jest-environment-jsdom',
  preset: 'ts-jest',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        jsx: 'react-jsx', // Enable JSX transformation
      },
    }],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  // Wall-clock ceiling per test. Heavier jsdom component suites use only ~1.3s of
  // CPU but can exceed Jest's 5s default under the parallel worker pool when CPU is
  // contended (seen as spurious "Exceeded timeout of 5000 ms" flakes in CI). This is
  // a total-duration guard only — waitFor/findBy* still default to 1000ms, so real
  // assertion failures and genuine hangs still surface fast.
  testTimeout: 15000,
  // tests/e2e holds Playwright specs — they run under `playwright test`, not Jest.
  testPathIgnorePatterns: ['<rootDir>/.next/', '<rootDir>/node_modules/', '<rootDir>/tests/e2e/'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
};