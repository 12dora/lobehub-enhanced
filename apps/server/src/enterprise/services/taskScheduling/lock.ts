import debug from 'debug';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

import type { SweepLockResult } from './types';

const log = debug('lobe-server:task-scheduling');

export const TASK_SCHEDULING_SWEEP_LOCK_KEY = 'task-scheduling:sweep';
/** Slightly shorter than the 60s sweep interval so the lock expires before the next tick. */
export const TASK_SCHEDULING_SWEEP_LOCK_TTL_SECONDS = 55;

/**
 * Cross-replica mutex. `held` → skip this sweep. Redis missing/error → `unavailable`
 * (caller still runs, with a warning).
 */
export const acquireSweepLock = async (): Promise<SweepLockResult> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) {
    console.warn('[task-scheduling] Redis unavailable; running sweep without a cross-replica lock');
    return 'unavailable';
  }

  try {
    const result = await redis.set(
      TASK_SCHEDULING_SWEEP_LOCK_KEY,
      String(process.pid),
      'EX',
      TASK_SCHEDULING_SWEEP_LOCK_TTL_SECONDS,
      'NX',
    );
    if (result === 'OK') return 'acquired';
    log('lock held by another replica, skip sweep');
    return 'held';
  } catch (error) {
    console.warn('[task-scheduling] Redis lock failed; running sweep anyway', {
      errorClass: error instanceof Error ? error.name : 'UnknownError',
    });
    return 'unavailable';
  }
};
