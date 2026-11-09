// Tests unitaires de l'API (sans base de données ni broker). Le package partagé est lu depuis ses sources.
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/test/**/*.spec.ts'],
  // 151002 : avertissement sur le mode de modules NodeNext, sans effet sur ces tests (sortie CommonJS).
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', diagnostics: { ignoreCodes: [151002] } }] },
  moduleNameMapper: {
    '^@project/shared-types$': '<rootDir>/../../packages/shared-types/src/index.ts',
    '^@project/shared-types/schemas/(.*)$': '<rootDir>/../../packages/shared-types/schemas/$1',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
