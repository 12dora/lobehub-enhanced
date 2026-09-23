import { defineConfig } from './src/libs/next/config/define-config';
import { dockerTracingExcludes } from './src/libs/next/config/dockerTracingExcludes';

const isVercel = !!process.env.VERCEL_ENV;
const isDocker = process.env.DOCKER === 'true';

const vercelConfig = {
  // Vercel serverless optimization: exclude musl binaries from all routes
  // Vercel uses Amazon Linux (glibc), not Alpine Linux (musl)
  // This saves ~45MB (29MB canvas-musl + 16MB sharp-musl) per serverless function
  outputFileTracingExcludes: {
    '*': [
      'node_modules/.pnpm/@napi-rs+canvas-*-musl*',
      'node_modules/.pnpm/@img+sharp-libvips-*musl*',
      // Exclude SPA/desktop/mobile build artifacts from serverless functions
      'public/_spa/**',
      'dist/desktop/**',
      'dist/mobile/**',
      'apps/desktop/**',
      'packages/database/migrations/**',
    ],
  },
};

const dockerConfig = {
  // Do not `require()` every server entry before Ready: the tRPC lambda entry alone drags
  // ~2000 modules / ~64 MB of chunks. Entries load on first request instead (measured:
  // boot RSS 500 → 274 MB, after a typical session 650 → 375 MB; first hit +~0.4 s once).
  experimental: { preloadEntriesOnStart: false },
  outputFileTracingExcludes: {
    '*': dockerTracingExcludes(),
  },
};

// defineConfig only accepts a narrow CustomNextConfig and does not forward distDir.
// Apply the E2E-owned distDir on the final NextConfig object so suite builds never
// write into the main `.next` tree (root type-check stays valid after E2E).
const nextConfig = defineConfig({
  ...(isVercel ? vercelConfig : isDocker ? dockerConfig : {}),
});

// pdf.js loads CMap / standard-font files with fs.readFile. They are data
// directories, not JS imports, so Next standalone tracing omits them unless
// listed here. The Docker image copies `.next/standalone` and does not copy
// node_modules/pdfjs-dist itself.
const pdfjsFontDataTracingIncludes = [
  'node_modules/pdfjs-dist/cmaps/**/*',
  'node_modules/pdfjs-dist/standard_fonts/**/*',
  'node_modules/.pnpm/pdfjs-dist@*/node_modules/pdfjs-dist/cmaps/**/*',
  'node_modules/.pnpm/pdfjs-dist@*/node_modules/pdfjs-dist/standard_fonts/**/*',
];

export default {
  ...nextConfig,
  outputFileTracingIncludes: {
    ...nextConfig.outputFileTracingIncludes,
    '*': [...(nextConfig.outputFileTracingIncludes?.['*'] ?? []), ...pdfjsFontDataTracingIncludes],
  },
  ...(process.env.E2E_ENTERPRISE_ADMIN_NEXT_DIST_DIR
    ? { distDir: process.env.E2E_ENTERPRISE_ADMIN_NEXT_DIST_DIR }
    : {}),
};
