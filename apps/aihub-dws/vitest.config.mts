import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
