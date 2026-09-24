import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

const repoRoot = resolve(__dirname, '../..');

// @emoji-mart/data's package entry is a JSON file. Node refuses to load it without
// an import attribute. Alias it (and the React picker) to the repo stubs the root
// vitest config already uses, so the editor suite never touches that JSON.
const alias = {
  '@emoji-mart/data': resolve(repoRoot, 'tests/mocks/emojiMartData.ts'),
  '@emoji-mart/react': resolve(repoRoot, 'tests/mocks/emojiMartReact.tsx'),
};

export default defineConfig({
  resolve: { alias },
  test: {
    alias,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'lcov', 'text-summary'],
    },
    environment: 'happy-dom',
    globals: true,
    server: {
      deps: {
        // Inline @emoji-mart packages to avoid ESM JSON import issues
        inline: ['emoji-mart', /@emoji-mart/, /@lobehub\//, 'lexical', /@lexical\//],
      },
    },
  },
});
