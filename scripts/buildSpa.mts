import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';

/**
 * Builds the three SPA bundles (desktop, mobile, auth). They write to separate
 * `dist/*` dirs, so they can run side by side. `SPA_BUILD_CONCURRENCY` caps how
 * many run at once (default 1 = serial, safe on small CI runners); the heap cap
 * shrinks as concurrency grows so the total stays bounded.
 */
const root = path.resolve(import.meta.dirname, '..');
const targets = [
  { env: {}, name: 'desktop' },
  { env: { MOBILE: 'true' }, name: 'mobile' },
  { env: { AUTH: 'true' }, name: 'auth' },
] as const;

const requested = Number(process.env.SPA_BUILD_CONCURRENCY);
const concurrency = Number.isInteger(requested) && requested > 0 ? requested : 1;
const heapMb = concurrency > 1 ? 6144 : 8192;

rmSync(path.resolve(root, 'public/_spa'), { force: true, recursive: true });
rmSync(path.resolve(root, 'public/_spa-auth'), { force: true, recursive: true });

const run = (target: (typeof targets)[number]): Promise<void> =>
  new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn('pnpm', ['exec', 'vite', 'build'], {
      cwd: root,
      env: {
        ...process.env,
        ...target.env,
        NODE_OPTIONS: `--max-old-space-size=${heapMb}`,
      },
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      if (code === 0) {
        console.log(`[build:spa] ${target.name} done in ${seconds}s`);
        resolve();
      } else {
        reject(new Error(`[build:spa] ${target.name} failed with exit code ${code}`));
      }
    });
  });

const queue = [...targets];
const worker = async (): Promise<void> => {
  for (let next = queue.shift(); next; next = queue.shift()) await run(next);
};

console.log(`[build:spa] concurrency=${concurrency} heap=${heapMb}MB`);
try {
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
