import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { AliasOptions, Plugin } from 'vite';

/**
 * `@/server/*` follows the root tsconfig paths: `apps/server/src/*`, then `src/server/*`.
 * A single string alias cannot express that fallback. The `@` alias must not swallow
 * `@/server`, because Vite applies aliases before `enforce: 'pre'` plugins.
 */
const FILE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.mjs', '.cjs', '.json'];

const isFile = (path: string): boolean => existsSync(path) && statSync(path).isFile();

const resolveExisting = (base: string): string | undefined => {
  if (isFile(base)) return base;
  for (const extension of FILE_EXTENSIONS) {
    const file = base + extension;
    if (isFile(file)) return file;
  }
  if (existsSync(base) && statSync(base).isDirectory()) {
    for (const extension of FILE_EXTENSIONS) {
      const index = join(base, `index${extension}`);
      if (isFile(index)) return index;
    }
  }
  return undefined;
};

export const resolveAtServerSpecifier = (packageDir: string, id: string): string | undefined => {
  const specifier = id.split('?')[0]?.split('#')[0] ?? id;
  if (specifier !== '@/server' && !specifier.startsWith('@/server/')) return undefined;

  const rest = specifier === '@/server' ? '' : specifier.slice('@/server/'.length);
  const roots = [
    resolve(packageDir, '../../apps/server/src'),
    resolve(packageDir, '../../src/server'),
  ];
  for (const root of roots) {
    const hit = resolveExisting(rest ? join(root, rest) : root);
    if (hit) return hit;
  }
  return undefined;
};

export const createResolveAtServerPlugin = (packageDir: string): Plugin => ({
  enforce: 'pre',
  name: 'resolve-at-server',
  resolveId(id) {
    return resolveAtServerSpecifier(packageDir, id);
  },
});

export const createDatabaseTestAlias = (packageDir: string): AliasOptions => {
  const srcRoot = resolve(packageDir, '../../src');
  return [
    { find: '@/const', replacement: resolve(packageDir, '../const/src') },
    { find: '@/utils/errorResponse', replacement: resolve(srcRoot, 'utils/errorResponse') },
    { find: '@/utils', replacement: resolve(packageDir, '../utils/src') },
    { find: '@/database', replacement: resolve(packageDir, '../database/src') },
    { find: '@/libs/model-runtime', replacement: resolve(packageDir, '../model-runtime/src') },
    { find: '@/types', replacement: resolve(packageDir, '../types/src') },
    { find: '@/config', replacement: resolve(packageDir, '../app-config/src') },
    { find: '@/envs', replacement: resolve(packageDir, '../env/src') },
    { find: '@/libs/trpc', replacement: resolve(packageDir, '../trpc/src') },
    { find: '@/locales', replacement: resolve(packageDir, '../locales/src') },
    { find: '@/business/server', replacement: resolve(packageDir, '../business-server/src') },
    // `@/server/*` is resolved by createResolveAtServerPlugin (apps/server, then src/server).
    { find: /^@\/(?!server(?:\/|$))/, replacement: `${srcRoot}/` },
  ];
};
