export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  maxWorkers: '50%',
  workerIdleMemoryLimit: '512MB',
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: './tsconfig.jest.json',
        isolatedModules: true,
      }
    ]
  },
  testMatch: ['**/tests/**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/client/src/$1',
    '^@shared/schema$': '<rootDir>/shared/schema.ts',
  },
};
