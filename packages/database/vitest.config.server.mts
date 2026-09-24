import { coverageConfigDefaults, defineConfig } from 'vitest/config';

import { createDatabaseTestAlias, createResolveAtServerPlugin } from './vitest.alias.mts';

export default defineConfig({
  plugins: [
    createResolveAtServerPlugin(__dirname),
    {
      name: 'raw-md',
      transform(_, id) {
        if (id.endsWith('.md')) return { code: 'export default ""', map: null };
      },
    },
  ],
  test: {
    alias: createDatabaseTestAlias(__dirname),
    coverage: {
      all: false,
      exclude: [
        // https://github.com/lobehub/lobe-chat/pull/7265
        ...coverageConfigDefaults.exclude,
        'src/server/core/dbForTest.ts',
      ],
      include: ['src/models/**/*.ts', 'src/server/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'json', 'lcov', 'text-summary'],
    },
    env: {
      TEST_SERVER_DB: '1',
    },
    environment: 'node',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    setupFiles: './tests/setup-db.ts',
  },
});
