/**
 * Jest Test Setup - IMP-024
 * Configuration and utilities for testing
 */

// Set test environment
process.env.NODE_ENV = 'test';
process.env.PORT = '9999';

// Silence console logs during tests (optional)
// global.console = {
//   ...console,
//   log: jest.fn(),
//   debug: jest.fn(),
//   info: jest.fn(),
//   warn: jest.fn(),
//   error: console.error
// };

// Global test timeout
jest.setTimeout(10000);

// Clean up after all tests
afterAll(async () => {
  // Close any open handles
  await new Promise(resolve => setTimeout(resolve, 500));
});
