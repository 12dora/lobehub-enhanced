import { defineConfig } from 'vitest/config';

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
  optimizeDeps: {
    exclude: ['crypto', 'util', 'tty'],
    include: ['@lobehub/tts'],
  },
  test: {
    alias: createDatabaseTestAlias(__dirname),
    coverage: {
      exclude: [
        'src/server/**',
        'src/repositories/dataImporter/deprecated/**',
        'src/types/**',
        'src/models/userMemory/sources/index.ts',
        'src/models/userMemory/sources/shared.ts',
        'src/models/ragEval/index.ts',
        'src/models/agentEval/index.ts',
        'src/repositories/userMemory/index.ts',
        'src/models/_template.ts',
        'src/models/__tests__/_test_template.ts',
        'src/models/web-server.ts',
        'src/core/web-server.ts',
        'src/core/db-adaptor.ts',
        'src/core/getTestDB.ts',
        'src/index.ts',
        'tests/**',
        'vitest.config*.mts',
      ],
      reporter: ['text', 'json'],
    },
    environment: 'happy-dom',
    exclude: [
      'node_modules/**/**',
      'src/server/**/**',
      'src/repositories/dataImporter/deprecated/**/**',
    ],
    server: {
      deps: {
        inline: ['vitest-canvas-mock'],
      },
    },
    setupFiles: './tests/setup-db.ts',
  },
});
