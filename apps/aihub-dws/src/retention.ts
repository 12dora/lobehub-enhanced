import { readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

import { RETENTION_INTERVAL_MS, RETENTION_MAX_AGE_MS } from './constants.ts';

async function sweepDir(dir: string, cutoff: number): Promise<number> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let removed = 0;
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isSymbolicLink()) continue;
    if (ent.isDirectory()) {
      removed += await sweepDir(full, cutoff);
      continue;
    }
    if (!ent.isFile()) continue;
    try {
      const info = await stat(full);
      if (info.mtimeMs < cutoff) {
        await unlink(full);
        removed += 1;
      }
    } catch {
      // raced with dws rotating the same file
    }
  }
  return removed;
}

/** Delete files older than 14 days under $DWS_CONFIG_DIR/audit and /logs. */
export async function sweepRetention(configDir: string, now = Date.now()): Promise<number> {
  const cutoff = now - RETENTION_MAX_AGE_MS;
  let removed = 0;
  for (const sub of ['audit', 'logs']) {
    removed += await sweepDir(path.join(configDir, sub), cutoff);
  }
  return removed;
}

export function startRetention(configDir: string, intervalMs = RETENTION_INTERVAL_MS): () => void {
  const timer = setInterval(() => {
    void sweepRetention(configDir);
  }, intervalMs);
  timer.unref();
  void sweepRetention(configDir);
  return () => clearInterval(timer);
}
