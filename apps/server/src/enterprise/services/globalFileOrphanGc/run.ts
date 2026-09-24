import debug from 'debug';
import { sql } from 'drizzle-orm';

import type { LobeChatDatabase } from '@/database/type';
import { createFileS3, type FileS3 } from '@/server/modules/S3';
import { lockGlobalFileHash } from '@/server/services/file/globalFileHashLock';

import { isGlobalFileOrphanGcDisabled } from './switch';

export { isGlobalFileOrphanGcDisabled };

const log = debug('lobe-server:enterprise-worker:global-file-orphan-gc');

export const GLOBAL_FILE_ORPHAN_GC_JOB_TYPE = 'platform.global_file.orphan_gc.v1';

export const GLOBAL_FILE_ORPHAN_GC_DEFAULTS = {
  batch: 100,
  cap: 500,
  graceDays: 7,
} as const;

/** Rows examined per run, including ones we skip. Stops a growing backlog from scanning forever. */
export const GLOBAL_FILE_ORPHAN_GC_SCAN_FACTOR = 5;

/** Consecutive DeleteObject failures after which the job fails. Already-deleted rows stay deleted. */
export const GLOBAL_FILE_ORPHAN_GC_S3_FAILURE_LIMIT = 5;

/** One hung DeleteObject must not stall every platform-job lane. */
export const GLOBAL_FILE_ORPHAN_GC_DELETE_TIMEOUT_MS = 30_000;

/** Object keys kept on the job summary when DeleteObject failed but the row is already gone. */
export const GLOBAL_FILE_ORPHAN_GC_UNTRACKED_KEY_CAP = 50;

/**
 * Object keys this job may delete. Anything else (avatars, traces, branding,
 * audit exports) is left in place and counted as failedObjects.
 * `files/` covers server-minted `files/generations`, `files/mcp`, and `files/render`
 * as well as client uploads. `generations/` is a separate top-level prefix.
 */
const BUILTIN_OBJECT_KEY_PREFIXES = [
  'files',
  'skills',
  'generations',
  'import_config',
  'ragEval',
  'eval-datasets',
] as const;

export interface GlobalFileOrphanGcConfig {
  batch: number;
  cap: number;
  dryRun: boolean;
  enabled: boolean;
  graceDays: number;
}

export interface GlobalFileOrphanGcPreview {
  bytes: number;
  count: number;
}

export interface GlobalFileOrphanGcSummary {
  /**
   * Dry-run: total bytes of every candidate.
   * Live: bytes of objects whose DeleteObject succeeded.
   */
  bytes: number;
  deletedObjects: number;
  deletedRows: number;
  dryRun: boolean;
  failedObjects: number;
  /** Dry-run: full candidate count. Live: candidates this run actually handled. */
  scanned: number;
  skippedRaced: number;
  /**
   * Rows already deleted whose DeleteObject failed or timed out.
   * Capped. Absent when every object delete succeeded.
   */
  untrackedObjectKeys?: string[];
}

export interface GlobalFileOrphanCandidate {
  /** `created_at` text from Postgres, kept so keyset pagination does not lose microseconds. */
  createdAt: string;
  hashId: string;
  size: number;
  url: string;
}

export interface RunGlobalFileOrphanGcOptions {
  /**
   * Runs after the row commit and before the re-check SELECT. Tests use it to
   * reinsert the content-addressed key; production omits it.
   */
  beforeObjectDelete?: (row: GlobalFileOrphanCandidate) => Promise<void>;
  /**
   * Test seam. Runs at the start of a row, before the delete. Production omits it.
   */
  beforeRow?: (row: GlobalFileOrphanCandidate) => Promise<void>;
  config?: Partial<GlobalFileOrphanGcConfig>;
  deleteObject?: (url: string) => Promise<unknown>;
  /** Test seam. Production uses {@link GLOBAL_FILE_ORPHAN_GC_DELETE_TIMEOUT_MS}. */
  deleteTimeoutMs?: number;
  env?: Partial<NodeJS.ProcessEnv>;
  signal?: AbortSignal;
}

const positiveInt = (value: string | undefined, fallback: number): number => {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
};

/** `1`, `true`, or `yes`, any case. Blank and anything else are false. */
const envFlag = (value: string | undefined): boolean => {
  if (value === undefined) return false;
  return ['1', 'true', 'yes'].includes(value.trim().toLowerCase());
};

/**
 * `GLOBAL_FILE_ORPHAN_GC` of `0`, `false`, `no`, or `off` (any case) disables
 * enqueue and makes a claimed job finish without deleting. Unset means enabled.
 * `GLOBAL_FILE_ORPHAN_GC_DRY_RUN` accepts `1`, `true`, or `yes` (any case).
 */
export const readGlobalFileOrphanGcConfig = (
  env: Partial<NodeJS.ProcessEnv> = process.env,
): GlobalFileOrphanGcConfig => ({
  batch: positiveInt(env.GLOBAL_FILE_ORPHAN_GC_BATCH, GLOBAL_FILE_ORPHAN_GC_DEFAULTS.batch),
  cap: positiveInt(env.GLOBAL_FILE_ORPHAN_GC_CAP, GLOBAL_FILE_ORPHAN_GC_DEFAULTS.cap),
  dryRun: envFlag(env.GLOBAL_FILE_ORPHAN_GC_DRY_RUN),
  enabled: !isGlobalFileOrphanGcDisabled(env.GLOBAL_FILE_ORPHAN_GC),
  graceDays: positiveInt(
    env.GLOBAL_FILE_ORPHAN_GC_GRACE_DAYS,
    GLOBAL_FILE_ORPHAN_GC_DEFAULTS.graceDays,
  ),
});

const normalizeObjectPrefix = (value: string): string | undefined => {
  const trimmed = value.trim().replaceAll(/^\/+|\/+$/g, '');
  if (!trimmed || trimmed.includes('\\') || trimmed.includes('://')) return undefined;
  const segments = trimmed.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    return undefined;
  }
  return trimmed;
};

/** Built-in prefixes plus `NEXT_PUBLIC_S3_FILE_PATH` when it is a relative prefix. */
export const globalFileObjectKeyPrefixes = (
  env: Partial<NodeJS.ProcessEnv> = process.env,
): string[] => {
  const prefixes = new Set<string>(BUILTIN_OBJECT_KEY_PREFIXES);
  const configured = env.NEXT_PUBLIC_S3_FILE_PATH
    ? normalizeObjectPrefix(env.NEXT_PUBLIC_S3_FILE_PATH)
    : undefined;
  if (configured) prefixes.add(configured);
  return [...prefixes];
};

/**
 * Refuse empty, absolute, backslash, and real traversal segments (`..` or `.`
 * as a whole segment). A name like `a..b.md` is allowed. Keys must also sit
 * under an allowlisted prefix; other keys are not deleted.
 */
export const isDeletableGlobalFileObjectKey = (
  key: string,
  prefixes: readonly string[] = BUILTIN_OBJECT_KEY_PREFIXES,
): boolean => {
  if (typeof key !== 'string' || key.length === 0 || key.trim().length === 0) return false;
  if (key.startsWith('/') || key.startsWith('\\')) return false;
  if (key.includes('\\') || key.includes('://')) return false;
  if (/^[a-z]:/i.test(key)) return false;
  for (const char of key) {
    const code = char.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return false;
  }

  const segments = key.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    return false;
  }

  return prefixes.some((prefix) => {
    const normalized = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
    return normalized.length > 0 && key.startsWith(`${normalized}/`);
  });
};

export class GlobalFileOrphanGcAbortedError extends Error {
  constructor() {
    super('global file orphan gc aborted');
    this.name = 'GlobalFileOrphanGcAbortedError';
  }
}

export class GlobalFileOrphanGcS3OutageError extends Error {
  readonly keys: string[];

  constructor(keys: string[]) {
    super(
      `global file orphan gc stopped after ${GLOBAL_FILE_ORPHAN_GC_S3_FAILURE_LIMIT} consecutive object storage failures`,
    );
    this.name = 'GlobalFileOrphanGcS3OutageError';
    this.keys = keys;
  }
}

/**
 * Unreferenced means no `files` row, no skill zip hash, and no skill resource
 * `fileHash`, and both timestamps are older than the grace window. `creator`
 * is intentionally not part of the predicate. A non-object `resources` value
 * is treated as empty so one bad row cannot abort the sweep.
 * `platform_global_credential_uploads.file_hash_id` is not a reference.
 */
const orphanPredicate = (graceDays: number) => sql`
  g.created_at < now() - (${graceDays}::int * interval '1 day')
  AND g.accessed_at < now() - (${graceDays}::int * interval '1 day')
  AND NOT EXISTS (SELECT 1 FROM files f WHERE f.file_hash = g.hash_id)
  AND NOT EXISTS (SELECT 1 FROM agent_skills s WHERE s.zip_file_hash = g.hash_id)
  AND NOT EXISTS (
    SELECT 1
    FROM agent_skills s
    CROSS JOIN LATERAL jsonb_each(
      CASE
        WHEN jsonb_typeof(COALESCE(s.resources, '{}'::jsonb)) = 'object'
          THEN COALESCE(s.resources, '{}'::jsonb)
        ELSE '{}'::jsonb
      END
    ) AS e(key, value)
    WHERE e.value->>'fileHash' = g.hash_id
  )
`;

const asNonNegative = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.trunc(value);
  if (typeof value === 'bigint' && value >= 0n) return Number(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.trunc(parsed);
  }
  return 0;
};

const field = (row: Record<string, unknown>, name: string): unknown => {
  if (name in row) return row[name];
  const lower = name.toLowerCase();
  if (lower in row) return row[lower];
  return undefined;
};

const rowsOf = (result: { rows?: unknown[] }): Record<string, unknown>[] =>
  (result.rows ?? []) as Record<string, unknown>[];

const hashPrefix = (hash: string): string => hash.slice(0, 8);

const createdAtText = (value: unknown): string | undefined => {
  if (typeof value === 'string' && value.trim() !== '') return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  return undefined;
};

interface KeysetCursor {
  createdAt: string;
  hashId: string;
}

const selectCandidates = async (
  db: LobeChatDatabase,
  graceDays: number,
  limit: number,
  cursor?: KeysetCursor,
): Promise<GlobalFileOrphanCandidate[]> => {
  // Keyset on (created_at, hash_id), compared as text so the cursor matches the
  // value we just read (no timestamptz round-trip). A NOT IN list of seen
  // hashes grows without a bound and can exceed Postgres' 65,535 parameters.
  const after = cursor
    ? sql`AND (g.created_at::text, g.hash_id) > (${cursor.createdAt}, ${cursor.hashId})`
    : sql``;
  const result = await db.execute(sql`
    SELECT g.hash_id AS "hashId",
           g.url AS "url",
           g.size AS "size",
           g.created_at::text AS "createdAt"
    FROM global_files g
    WHERE ${orphanPredicate(graceDays)}
    ${after}
    ORDER BY g.created_at, g.hash_id
    LIMIT ${limit}
  `);
  const candidates: GlobalFileOrphanCandidate[] = [];
  for (const row of rowsOf(result)) {
    const hashId = field(row, 'hashId');
    const url = field(row, 'url');
    const createdAt = createdAtText(field(row, 'createdAt'));
    if (typeof hashId !== 'string' || typeof url !== 'string' || !createdAt) continue;
    candidates.push({ createdAt, hashId, size: asNonNegative(field(row, 'size')), url });
  }
  return candidates;
};

const deleteOrphanRow = async (
  db: LobeChatDatabase,
  hashId: string,
  graceDays: number,
): Promise<boolean> =>
  db.transaction(async (tx) => {
    // Bound the row lock. The dispatcher joins every lane before it heartbeats,
    // so a DELETE waiting on a lock would stall the other platform jobs and
    // look like a missed worker tick.
    await tx.execute(sql`select set_config('lock_timeout', '5s', true)`);
    const result = await tx.execute(sql`
      DELETE FROM global_files AS g
      WHERE g.hash_id = ${hashId}
        AND ${orphanPredicate(graceDays)}
      RETURNING g.hash_id AS "hashId"
    `);
    return rowsOf(result).length > 0;
  });

const objectKeyStillRegistered = async (
  db: LobeChatDatabase,
  hashId: string,
  url: string,
): Promise<boolean> => {
  // No index on global_files.url (only global_files_creator_idx). hash_id hits
  // the primary key; the url side is a sequential scan. The table is tiny
  // (tens of rows in production). Do not add a migration for this lookup.
  const result = await db.execute(sql`
    SELECT 1 AS hit
    FROM global_files
    WHERE hash_id = ${hashId} OR url = ${url}
    LIMIT 1
  `);
  return rowsOf(result).length > 0;
};

const isLockTimeout = (error: unknown): boolean => {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const record = current as { cause?: unknown; code?: unknown; message?: unknown };
    if (record.code === '55P03') return true;
    if (typeof record.message === 'string' && /lock timeout/i.test(record.message)) return true;
    current = record.cause;
  }
  return false;
};

const errorClass = (error: unknown): string =>
  error instanceof Error ? error.name : 'UnknownError';

const DELETE_ERROR_NAME = 'GlobalFileOrphanGcDeleteError';

export const capUntrackedObjectKeys = (keys: readonly string[]): string[] =>
  keys.slice(0, GLOBAL_FILE_ORPHAN_GC_UNTRACKED_KEY_CAP);

const isAbortError = (error: unknown, signal?: AbortSignal): boolean =>
  Boolean(signal?.aborted) || error instanceof GlobalFileOrphanGcAbortedError;

/** Rejects when DeleteObject exceeds the deadline. The in-flight call is not cancelled. */
const awaitWithDeadline = async (
  work: Promise<unknown>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> => {
  if (signal?.aborted) throw new GlobalFileOrphanGcAbortedError();
  void work.catch(() => undefined);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      onAbort = () => reject(new GlobalFileOrphanGcAbortedError());
      signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => reject(new Error('DeleteObject timed out')), timeoutMs);
      work.then(
        () => resolve(),
        (error: unknown) => reject(error),
      );
    });
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
};

const asDeleteError = (error: unknown): Error => {
  const wrapped = new Error(error instanceof Error ? error.message : 'DeleteObject failed');
  wrapped.name = DELETE_ERROR_NAME;
  (wrapped as { cause?: unknown }).cause = error;
  return wrapped;
};

const findDeleteError = (error: unknown): (Error & { cause?: unknown }) | undefined => {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error && current.name === DELETE_ERROR_NAME) {
      return current as Error & { cause?: unknown };
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
};

const publish = (
  summary: GlobalFileOrphanGcSummary,
  hashPrefixes: string[],
): GlobalFileOrphanGcSummary => {
  log('finished %O', { ...summary, hashPrefixes });
  console.info('[global-file-orphan-gc]', summary);
  return summary;
};

/**
 * Read-only candidate count and total bytes. Does not delete rows or objects.
 * Use this against production before enabling the sweep.
 */
export const previewGlobalFileOrphanGc = async (
  db: LobeChatDatabase,
  options?: { env?: Partial<NodeJS.ProcessEnv>; graceDays?: number },
): Promise<GlobalFileOrphanGcPreview> => {
  const graceDays = options?.graceDays ?? readGlobalFileOrphanGcConfig(options?.env).graceDays;
  const result = await db.execute(sql`
    SELECT count(*)::int AS "count", coalesce(sum(g.size), 0)::bigint AS "bytes"
    FROM global_files g
    WHERE ${orphanPredicate(graceDays)}
  `);
  const row = rowsOf(result)[0];
  return {
    bytes: asNonNegative(row ? field(row, 'bytes') : 0),
    count: asNonNegative(row ? field(row, 'count') : 0),
  };
};

const resolveConfig = (options: RunGlobalFileOrphanGcOptions): GlobalFileOrphanGcConfig => ({
  ...readGlobalFileOrphanGcConfig(options.env),
  ...options.config,
});

const emptySummary = (dryRun: boolean): GlobalFileOrphanGcSummary => ({
  bytes: 0,
  deletedObjects: 0,
  deletedRows: 0,
  dryRun,
  failedObjects: 0,
  scanned: 0,
  skippedRaced: 0,
});

/**
 * Row first, then the object. Each hash commits alone. A crash mid-cap leaves
 * the rest for the next run. One row's error does not abort the sweep.
 * After 5 consecutive S3 failures the job fails; rows already deleted stay
 * deleted and their keys are logged. Each DeleteObject is limited to 30s.
 * The re-check and DeleteObject share a transaction advisory lock with reuse
 * reinserts, so a live row cannot appear in that window.
 */
export const runGlobalFileOrphanGc = async (
  db: LobeChatDatabase,
  options: RunGlobalFileOrphanGcOptions = {},
): Promise<GlobalFileOrphanGcSummary> => {
  const config = resolveConfig(options);

  if (!config.enabled) {
    return publish(emptySummary(config.dryRun), []);
  }

  if (config.dryRun) {
    const preview = await previewGlobalFileOrphanGc(db, { graceDays: config.graceDays });
    const sample = await selectCandidates(db, config.graceDays, config.batch);
    return publish(
      {
        bytes: preview.bytes,
        deletedObjects: 0,
        deletedRows: 0,
        dryRun: true,
        failedObjects: 0,
        scanned: preview.count,
        skippedRaced: 0,
      },
      sample.map((row) => hashPrefix(row.hashId)),
    );
  }

  const s3 = options.deleteObject ? null : await createFileS3();
  const deleteObject = (url: string): Promise<unknown> =>
    options.deleteObject ? options.deleteObject(url) : (s3 as FileS3).deleteFile(url);
  const deleteTimeoutMs = options.deleteTimeoutMs ?? GLOBAL_FILE_ORPHAN_GC_DELETE_TIMEOUT_MS;
  const keyPrefixes = globalFileObjectKeyPrefixes(options.env);

  let bytes = 0;
  let deletedObjects = 0;
  let deletedRows = 0;
  let failedObjects = 0;
  let scanned = 0;
  let skippedRaced = 0;
  let consecutiveS3Failures = 0;
  const untrackedKeys: string[] = [];
  const prefixes: string[] = [];
  const scanLimit = config.cap * GLOBAL_FILE_ORPHAN_GC_SCAN_FACTOR;
  let cursor: KeysetCursor | undefined;
  let previousCursorKey = '';

  while (deletedRows < config.cap && scanned < scanLimit) {
    if (options.signal?.aborted) throw new GlobalFileOrphanGcAbortedError();
    const limit = Math.min(config.batch, scanLimit - scanned);
    const rows = await selectCandidates(db, config.graceDays, limit, cursor);
    if (rows.length === 0) break;
    const batchEnd = rows.at(-1)!;
    const batchEndKey = `${batchEnd.createdAt}\0${batchEnd.hashId}`;
    if (batchEndKey === previousCursorKey) break;
    previousCursorKey = batchEndKey;

    for (const row of rows) {
      if (options.signal?.aborted) throw new GlobalFileOrphanGcAbortedError();
      if (deletedRows >= config.cap || scanned >= scanLimit) break;
      cursor = { createdAt: row.createdAt, hashId: row.hashId };
      scanned += 1;
      if (prefixes.length < config.cap) prefixes.push(hashPrefix(row.hashId));

      try {
        if (options.beforeRow) await options.beforeRow(row);

        if (!isDeletableGlobalFileObjectKey(row.url, keyPrefixes)) {
          failedObjects += 1;
          log('skip object key outside allowlist %O', { hashPrefix: hashPrefix(row.hashId) });
          continue;
        }

        const deleted = await deleteOrphanRow(db, row.hashId, config.graceDays);
        if (!deleted) continue;
        deletedRows += 1;

        if (options.beforeObjectDelete) await options.beforeObjectDelete(row);

        let skipped = false;
        try {
          // Hold the hash lock from the re-check through DeleteObject. A reuse
          // reinsert takes the same lock, so it cannot commit in this window.
          await db.transaction(async (tx) => {
            await lockGlobalFileHash(tx, row.hashId);
            if (await objectKeyStillRegistered(tx as LobeChatDatabase, row.hashId, row.url)) {
              skipped = true;
              return;
            }
            try {
              await awaitWithDeadline(deleteObject(row.url), deleteTimeoutMs, options.signal);
            } catch (error) {
              if (isAbortError(error, options.signal)) throw error;
              throw asDeleteError(error);
            }
          });
        } catch (error) {
          if (isAbortError(error, options.signal)) throw error;
          if (isLockTimeout(error)) {
            skippedRaced += 1;
            log('object delete skipped after lock timeout %O', {
              hashPrefix: hashPrefix(row.hashId),
            });
            continue;
          }
          const deleteError = findDeleteError(error);
          if (!deleteError) throw error;
          failedObjects += 1;
          consecutiveS3Failures += 1;
          untrackedKeys.push(row.url);
          log('object delete failed %O', {
            errorClass: errorClass(deleteError.cause ?? deleteError),
            hashPrefix: hashPrefix(row.hashId),
            key: row.url,
          });
          if (consecutiveS3Failures >= GLOBAL_FILE_ORPHAN_GC_S3_FAILURE_LIMIT) {
            console.error('[global-file-orphan-gc] stopped after consecutive S3 failures', {
              keys: untrackedKeys,
            });
            throw new GlobalFileOrphanGcS3OutageError(untrackedKeys);
          }
          continue;
        }

        if (skipped) {
          skippedRaced += 1;
          log('skip object delete; key reappeared %O', { hashPrefix: hashPrefix(row.hashId) });
          continue;
        }

        consecutiveS3Failures = 0;
        deletedObjects += 1;
        bytes += row.size;
      } catch (error) {
        if (
          options.signal?.aborted ||
          error instanceof GlobalFileOrphanGcAbortedError ||
          error instanceof GlobalFileOrphanGcS3OutageError
        ) {
          throw error;
        }
        if (isLockTimeout(error)) {
          skippedRaced += 1;
          log('row skipped after lock timeout %O', { hashPrefix: hashPrefix(row.hashId) });
        } else {
          failedObjects += 1;
          log('row failed %O', {
            errorClass: errorClass(error),
            hashPrefix: hashPrefix(row.hashId),
          });
        }
      }
    }

    if (rows.length < limit) break;
  }

  const untrackedObjectKeys = capUntrackedObjectKeys(untrackedKeys);
  if (untrackedObjectKeys.length > 0) {
    console.warn('[global-file-orphan-gc] objects left after row delete', {
      keys: untrackedObjectKeys,
    });
  }

  return publish(
    {
      bytes,
      deletedObjects,
      deletedRows,
      dryRun: false,
      failedObjects,
      scanned,
      skippedRaced,
      ...(untrackedObjectKeys.length > 0 ? { untrackedObjectKeys } : {}),
    },
    prefixes,
  );
};
