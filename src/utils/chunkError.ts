import { toast } from '@lobehub/ui';

const CHUNK_ERROR_PATTERNS = [
  'Failed to fetch dynamically imported module', // Chrome / Vite
  'error loading dynamically imported module', // Firefox
  'Importing a module script failed', // Safari
  'Failed to load module script', // Safari variant
  'Loading chunk', // Webpack
  'Loading CSS chunk', // Webpack CSS
  'ChunkLoadError', // Webpack error name
];

/**
 * Detect whether an error (or its message) was caused by a failed chunk / dynamic import.
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;

  const name = (error as Error).name ?? '';
  const message = (error as Error).message ?? String(error);
  const combined = `${name} ${message}`;

  return CHUNK_ERROR_PATTERNS.some((p) => combined.includes(p));
}

const RELOAD_KEY = 'lobe-chunk-reload';

/**
 * Two chunk failures this close together mean the reload did not help (the new
 * chunk is genuinely broken / offline), so we stop and let the user decide.
 *
 * The marker is a timestamp rather than a boolean on purpose: a long-lived tab
 * survives several deploys, and a boolean latch would spend its single
 * auto-recovery on the first one and then drop the user on the route error
 * screen for every later deploy — the failure mode that looked like a crash.
 */
const RELOAD_COOLDOWN = 10_000;

/**
 * Auto-reload on chunk load error, at most once per {@link RELOAD_COOLDOWN}
 * window, so a chunk that keeps failing can never spin into a reload loop.
 */
export function notifyChunkError(): void {
  const lastReloadAt = Number(sessionStorage.getItem(RELOAD_KEY)) || 0;

  if (lastReloadAt && Date.now() - lastReloadAt < RELOAD_COOLDOWN) {
    sessionStorage.removeItem(RELOAD_KEY);
    toast.error('There is a new version for the web app. Refresh the page to update');
    return;
  }

  sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  window.location.reload();
}
