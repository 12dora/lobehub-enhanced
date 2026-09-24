import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const packageDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageDir, '../..');

export default defineConfig({
  resolve: {
    // The executor dynamically imports app services via `@/*`. The test mocks
    // that module, but Vite still has to resolve the specifier or Node treats
    // `@/services/aiAgent` as a missing package.
    alias: {
      '@': resolve(repoRoot, 'src'),
    },
  },
  test: {
    environment: 'node',
  },
});
