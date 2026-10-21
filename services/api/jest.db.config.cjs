// Database integration tests (I-02): run only via `pnpm test:db` with a local database.
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/test-db/**/*.test.ts'],
  globalSetup: '<rootDir>/test-db/global-setup.cjs',
  globalTeardown: '<rootDir>/test-db/global-teardown.cjs',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: { module: 'node16', moduleResolution: 'node16', types: ['jest', 'node'] } }],
  },
};
