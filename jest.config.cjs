/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'jsdom',
  testEnvironmentOptions: {
    url: 'http://localhost:5174'
  },
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@wagmi|wagmi|viem|@noble|abitype|ox|isows|eventemitter3|@coinbase|@metamask|@safe-global|@walletconnect|@mipd)/)'
  ],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          module: 'ESNext',
          target: 'ES2020',
          moduleResolution: 'bundler',
          esModuleInterop: true,
          strict: true,
          skipLibCheck: true
        }
      }
    ]
  },
  setupFiles: ['<rootDir>/tests/setup.ts'],
  testMatch: ['<rootDir>/tests/**/*.test.ts']
};
