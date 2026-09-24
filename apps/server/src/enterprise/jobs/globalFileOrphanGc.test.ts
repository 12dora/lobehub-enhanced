// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { platformJobs } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { GlobalFileOrphanGcAbortedError } from '../services/globalFileOrphanGc/run';
import {
  readWorkerHeartbeatMemory,
  resetWorkerHeartbeatForTest,
  setWorkerHeartbeatStoreForTest,
} from '../services/platformSystem/workerHeartbeat';
import {
  enqueueGlobalFileOrphanGcJob,
  ensureGlobalFileOrphanGcStarted,
  GLOBAL_FILE_ORPHAN_GC_JOB_TYPE,
  GLOBAL_FILE_ORPHAN_GC_SCHEDULER_INTERVAL_MS,
  globalFileOrphanGcIdempotencyKey,
  handleClaimedGlobalFileOrphanGcJob,
  isGlobalFileOrphanGcWindowOpen,
  resetGlobalFileOrphanGcSchedulerForTest,
  runGlobalFileOrphanGcEnqueuePass,
} from './globalFileOrphanGc';
import { startPersistentWorkerScheduler } from './persistentWorkerScheduler';
import { ensurePlatformJobsDispatcherStarted } from './platformJobsDispatcher';

vi.mock('./persistentWorkerScheduler', () => ({
  startPersistentWorkerScheduler: vi.fn(() => ({ stop: vi.fn(), wake: vi.fn() })),
}));

vi.mock('./platformJobsDispatcher', () => ({
  ensurePlatformJobsDispatcherStarted: vi.fn(),
}));

const db: LobeChatDatabase = await getTestDB();

const productionEnv = {
  DATABASE_URL: 'postgres://localhost/aihub',
  NODE_ENV: 'production',
} satisfies Partial<NodeJS.ProcessEnv>;

/** 2026-09-24 02:00 Asia/Shanghai — before the window. */
const beforeWindow = new Date('2026-09-23T18:00:00.000Z');
/** 2026-09-24 03:30 Asia/Shanghai — window opens. */
const atWindow = new Date('2026-09-23T19:30:00.000Z');
/** 2026-09-24 15:00 Asia/Shanghai — catch-up. */
const afternoon = new Date('2026-09-24T07:00:00.000Z');
/** 2026-09-25 15:00 Asia/Shanghai — next local date. */
const nextAfternoon = new Date('2026-09-25T07:00:00.000Z');

const emptySummary = {
  bytes: 0,
  deletedObjects: 0,
  deletedRows: 0,
  dryRun: false,
  failedObjects: 0,
  scanned: 0,
  skippedRaced: 0,
};

beforeEach(() => {
  setWorkerHeartbeatStoreForTest(null);
});

afterEach(async () => {
  resetGlobalFileOrphanGcSchedulerForTest();
  resetWorkerHeartbeatForTest();
  vi.clearAllMocks();
  await db.delete(platformJobs).where(eq(platformJobs.type, GLOBAL_FILE_ORPHAN_GC_JOB_TYPE));
});

describe('shanghai window', () => {
  it('waits before 03:30 and catches up later the same Shanghai date', () => {
    expect(isGlobalFileOrphanGcWindowOpen(beforeWindow)).toBe(false);
    expect(globalFileOrphanGcIdempotencyKey(beforeWindow)).toBe('global-file-orphan-gc:2026-09-24');
    expect(isGlobalFileOrphanGcWindowOpen(atWindow)).toBe(true);
    expect(globalFileOrphanGcIdempotencyKey(atWindow)).toBe('global-file-orphan-gc:2026-09-24');
    expect(isGlobalFileOrphanGcWindowOpen(afternoon)).toBe(true);
    expect(globalFileOrphanGcIdempotencyKey(afternoon)).toBe('global-file-orphan-gc:2026-09-24');
    expect(globalFileOrphanGcIdempotencyKey(nextAfternoon)).toBe(
      'global-file-orphan-gc:2026-09-25',
    );
  });
});

describe('enqueueGlobalFileOrphanGcJob', () => {
  it('does not enqueue before 03:30 or when GLOBAL_FILE_ORPHAN_GC=0', async () => {
    await expect(
      enqueueGlobalFileOrphanGcJob(db, { env: productionEnv, now: beforeWindow }),
    ).resolves.toEqual({ created: false, skipped: 'before-window' });
    await expect(
      enqueueGlobalFileOrphanGcJob(db, {
        env: { ...productionEnv, GLOBAL_FILE_ORPHAN_GC: '0' },
        now: afternoon,
      }),
    ).resolves.toEqual({ created: false, skipped: 'disabled' });
    for (const value of ['false', 'NO', 'off']) {
      await expect(
        enqueueGlobalFileOrphanGcJob(db, {
          env: { ...productionEnv, GLOBAL_FILE_ORPHAN_GC: value },
          now: afternoon,
        }),
      ).resolves.toEqual({ created: false, skipped: 'disabled' });
    }

    const rows = await db
      .select({ id: platformJobs.id })
      .from(platformJobs)
      .where(eq(platformJobs.type, GLOBAL_FILE_ORPHAN_GC_JOB_TYPE));
    expect(rows).toHaveLength(0);
  });

  it('returns created: false for a second enqueue on the same Shanghai date', async () => {
    const first = await enqueueGlobalFileOrphanGcJob(db, { env: productionEnv, now: afternoon });
    const second = await enqueueGlobalFileOrphanGcJob(db, { env: productionEnv, now: atWindow });
    const nextDay = await enqueueGlobalFileOrphanGcJob(db, {
      env: productionEnv,
      now: nextAfternoon,
    });

    expect(first.created).toBe(true);
    expect(second).toEqual({ created: false, jobId: first.jobId });
    expect(nextDay.created).toBe(true);
    expect(nextDay.jobId).not.toBe(first.jobId);

    const row = await db.query.platformJobs.findFirst({
      where: eq(platformJobs.id, first.jobId!),
    });
    expect(row?.maxAttempts).toBe(2);
    expect(row?.idempotencyKey).toBe('global-file-orphan-gc:2026-09-24');
    expect(row?.type).toBe('platform.global_file.orphan_gc.v1');
  });
});

describe('runGlobalFileOrphanGcEnqueuePass', () => {
  it('ticks the heartbeat and does not enqueue when the switch is off', async () => {
    await expect(
      runGlobalFileOrphanGcEnqueuePass({
        db,
        env: { ...productionEnv, GLOBAL_FILE_ORPHAN_GC: 'no' },
        now: afternoon,
      }),
    ).resolves.toEqual({ created: false, skipped: 'disabled' });
    expect(readWorkerHeartbeatMemory().get('global_file_orphan_gc')).toMatchObject({
      failed: false,
    });
  });

  it('ticks the hourly heartbeat and enqueues when the window is open', async () => {
    const result = await runGlobalFileOrphanGcEnqueuePass({
      db,
      env: productionEnv,
      now: afternoon,
    });
    expect(result.created).toBe(true);
    expect(readWorkerHeartbeatMemory().get('global_file_orphan_gc')).toMatchObject({
      failed: false,
      intervalMs: 60 * 60 * 1000,
    });
  });
});

describe('ensureGlobalFileOrphanGcStarted', () => {
  it('starts one 10-minute scheduler on the persistent runtime', () => {
    ensureGlobalFileOrphanGcStarted(productionEnv);
    ensureGlobalFileOrphanGcStarted(productionEnv);
    expect(startPersistentWorkerScheduler).toHaveBeenCalledTimes(1);
    expect(startPersistentWorkerScheduler).toHaveBeenCalledWith(
      expect.objectContaining({
        baseIntervalMs: GLOBAL_FILE_ORPHAN_GC_SCHEDULER_INTERVAL_MS,
        namespace: 'global-file-orphan-gc',
      }),
    );
    expect(GLOBAL_FILE_ORPHAN_GC_SCHEDULER_INTERVAL_MS).toBe(10 * 60 * 1000);
    expect(ensurePlatformJobsDispatcherStarted).toHaveBeenCalledWith({ env: productionEnv });
  });

  it('does not start when the runtime is not persistent or enqueue is disabled', () => {
    ensureGlobalFileOrphanGcStarted({ ...productionEnv, NODE_ENV: 'test' });
    ensureGlobalFileOrphanGcStarted({ ...productionEnv, GLOBAL_FILE_ORPHAN_GC: '0' });
    ensureGlobalFileOrphanGcStarted({ ...productionEnv, GLOBAL_FILE_ORPHAN_GC: 'false' });
    expect(startPersistentWorkerScheduler).not.toHaveBeenCalled();
    expect(ensurePlatformJobsDispatcherStarted).not.toHaveBeenCalled();
  });
});

describe('handleClaimedGlobalFileOrphanGcJob', () => {
  const claim = async (now: Date) => {
    const { jobId } = await enqueueGlobalFileOrphanGcJob(db, {
      env: productionEnv,
      now,
    });
    await db
      .update(platformJobs)
      .set({
        leaseOwner: 'worker-1',
        leaseUntil: new Date(Date.now() + 120_000),
        status: 'running',
      })
      .where(eq(platformJobs.id, jobId!));
    const job = await db.query.platformJobs.findFirst({ where: eq(platformJobs.id, jobId!) });
    return {
      db,
      job: job!,
      spec: {
        batchLimit: 1,
        intervalMs: 60_000,
        jobType: GLOBAL_FILE_ORPHAN_GC_JOB_TYPE,
        leaseMs: 15 * 60_000,
        workerName: 'globalFileOrphanGc',
      },
      workerId: 'worker-1',
    };
  };

  it('writes the sweep summary onto the job', async () => {
    const ctx = await claim(afternoon);
    await handleClaimedGlobalFileOrphanGcJob(ctx, {
      env: productionEnv,
      run: async () => emptySummary,
    });
    const row = await db.query.platformJobs.findFirst({ where: eq(platformJobs.id, ctx.job.id) });
    expect(row?.status).toBe('succeeded');
    expect(row?.resultSummary).toMatchObject(emptySummary);
  });

  it('retries when the sweep throws and leaves an aborted job running', async () => {
    const failed = await claim(afternoon);
    await handleClaimedGlobalFileOrphanGcJob(failed, {
      env: productionEnv,
      run: async () => {
        throw new Error('db down');
      },
    });
    const failedRow = await db.query.platformJobs.findFirst({
      where: eq(platformJobs.id, failed.job.id),
    });
    expect(failedRow?.status).toBe('pending');
    expect(failedRow?.lastError).toMatchObject({ message: 'db down' });

    const aborted = await claim(nextAfternoon);
    await handleClaimedGlobalFileOrphanGcJob(aborted, {
      env: productionEnv,
      run: async () => {
        throw new GlobalFileOrphanGcAbortedError();
      },
    });
    const abortedRow = await db.query.platformJobs.findFirst({
      where: eq(platformJobs.id, aborted.job.id),
    });
    expect(abortedRow?.status).toBe('running');
  });

  it('completes a claimed job without sweeping when GLOBAL_FILE_ORPHAN_GC=0', async () => {
    const ctx = await claim(afternoon);
    const run = vi.fn(async () => emptySummary);
    await handleClaimedGlobalFileOrphanGcJob(ctx, {
      env: { ...productionEnv, GLOBAL_FILE_ORPHAN_GC: '0' },
      run,
    });

    expect(run).not.toHaveBeenCalled();
    const row = await db.query.platformJobs.findFirst({ where: eq(platformJobs.id, ctx.job.id) });
    expect(row?.status).toBe('succeeded');
    expect(row?.resultSummary).toEqual({ skipped: 'disabled' });
  });
});
