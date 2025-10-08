export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: './tsconfig.jest.json'
      }
    ]
  },
  testMatch: ['**/server/**/*.test.ts'],
  moduleNameMapper: {
    '^@shared/schema$': '<rootDir>/shared/schema.ts',
  },
};
