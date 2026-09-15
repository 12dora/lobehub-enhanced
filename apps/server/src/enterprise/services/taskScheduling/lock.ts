import { randomUUID } from 'node:crypto';

import debug from 'debug';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

import type { SweepLockHandle, SweepLockResult } from './types';

const log = debug('lobe-server:task-scheduling');

export const TASK_SCHEDULING_SWEEP_LOCK_KEY = 'task-scheduling:sweep';

/**
 * 5 minutes — well above a worst-case sweep (many due crons/heartbeats at
 * concurrency 3, including `execAgent` kickoff). We chose a long TTL plus
 * compare-and-delete release over extend-while-in-flight: the sweep is one
 * critical section that should finish or expire as a unit, and a refresh loop
 * would add Redis chatter without changing the ownership model.
 */
export const TASK_SCHEDULING_SWEEP_LOCK_TTL_SECONDS = 5 * 60;

/** Compare-and-delete: only the token holder can drop the key. */
export const RELEASE_SWEEP_LOCK_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

const noopRelease = async (): Promise<void> => {};

const handle = (result: SweepLockResult, release: SweepLockHandle['release']): SweepLockHandle => ({
  release,
  result,
});

/**
 * Cross-replica mutex. `held` → skip this sweep. Redis missing/error → `unavailable`
 * (caller still runs, with a warning). The caller MUST `release()` after the
 * critical section when `result === 'acquired'` (safe to call in all cases —
 * held/unavailable are no-ops).
 */
export const acquireSweepLock = async (): Promise<SweepLockHandle> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) {
    console.warn('[task-scheduling] Redis unavailable; running sweep without a cross-replica lock');
    return handle('unavailable', noopRelease);
  }

  const token = randomUUID();

  try {
    const result = await redis.set(
      TASK_SCHEDULING_SWEEP_LOCK_KEY,
      token,
      'EX',
      TASK_SCHEDULING_SWEEP_LOCK_TTL_SECONDS,
      'NX',
    );
    if (result !== 'OK') {
      log('lock held by another replica, skip sweep');
      return handle('held', noopRelease);
    }
  } catch (error) {
    console.warn('[task-scheduling] Redis lock failed; running sweep anyway', {
      errorClass: error instanceof Error ? error.name : 'UnknownError',
    });
    return handle('unavailable', noopRelease);
  }

  return handle('acquired', async () => {
    try {
      await redis.eval(RELEASE_SWEEP_LOCK_SCRIPT, 1, TASK_SCHEDULING_SWEEP_LOCK_KEY, token);
    } catch (error) {
      console.warn('[task-scheduling] Redis lock release failed', {
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  });
};
