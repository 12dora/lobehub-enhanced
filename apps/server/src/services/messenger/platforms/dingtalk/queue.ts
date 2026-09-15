import debug from 'debug';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

import {
  DINGTALK_BUSY_KEY_PREFIX,
  DINGTALK_BUSY_TTL_SECONDS,
  DINGTALK_QUEUE_KEY_PREFIX,
  DINGTALK_QUEUE_MAX_LENGTH,
  DINGTALK_QUEUE_TTL_SECONDS,
} from './const';

const log = debug('lobe-server:messenger:dingtalk:queue');

export interface DingTalkQueuedMessage {
  authorUserName?: string;
  queuedAt: number;
  raw?: unknown;
  senderStaffId: string;
  text: string;
  topicId?: string;
}

export type DingTalkQueuePushResult = 'full' | 'queued' | 'unavailable';

export type DingTalkBusyClaim = 'acquired' | 'busy' | 'unavailable';

export type DingTalkQueuePopResult =
  | { item: DingTalkQueuedMessage; status: 'item' }
  | { status: 'empty' }
  | { status: 'error' }
  | { status: 'invalid' };

const queueKey = (threadId: string): string => `${DINGTALK_QUEUE_KEY_PREFIX}${threadId}`;

const busyKey = (threadId: string): string => `${DINGTALK_BUSY_KEY_PREFIX}${threadId}`;

/** This process currently owns the busy flag (Redis or memory). */
const processOwned = new Set<string>();

/** threadId → expiry epoch ms. Used when Redis is unset. SET throw is `'unavailable'`. */
const memoryBusyExpiry = new Map<string, number>();

const memoryBusyTimers = new Map<string, ReturnType<typeof setTimeout>>();

const memoryQueues = new Map<string, DingTalkQueuedMessage[]>();

const memoryQueueTimers = new Map<string, ReturnType<typeof setTimeout>>();

const busyTtlMs = () => DINGTALK_BUSY_TTL_SECONDS * 1000;

const queueTtlMs = () => DINGTALK_QUEUE_TTL_SECONDS * 1000;

const clearTimer = (timers: Map<string, ReturnType<typeof setTimeout>>, key: string): void => {
  const timer = timers.get(key);
  if (timer) {
    clearTimeout(timer);
    timers.delete(key);
  }
};

const armTimer = (
  timers: Map<string, ReturnType<typeof setTimeout>>,
  key: string,
  ttlMs: number,
  onExpire: () => void,
): void => {
  clearTimer(timers, key);
  const timer = setTimeout(onExpire, ttlMs);
  timer.unref?.();
  timers.set(key, timer);
};

const pruneMemoryBusy = (threadId?: string): void => {
  const now = Date.now();
  const ids = threadId ? [threadId] : [...memoryBusyExpiry.keys()];
  for (const id of ids) {
    const expiresAt = memoryBusyExpiry.get(id);
    if (expiresAt !== undefined && expiresAt <= now) {
      memoryBusyExpiry.delete(id);
      processOwned.delete(id);
      clearTimer(memoryBusyTimers, id);
    }
  }
};

const armMemoryBusy = (threadId: string): void => {
  memoryBusyExpiry.set(threadId, Date.now() + busyTtlMs());
  processOwned.add(threadId);
  armTimer(memoryBusyTimers, threadId, busyTtlMs(), () => {
    memoryBusyExpiry.delete(threadId);
    processOwned.delete(threadId);
    memoryBusyTimers.delete(threadId);
  });
};

const clearMemoryBusy = (threadId: string): void => {
  memoryBusyExpiry.delete(threadId);
  processOwned.delete(threadId);
  clearTimer(memoryBusyTimers, threadId);
};

const armMemoryQueue = (threadId: string): void => {
  armTimer(memoryQueueTimers, threadId, queueTtlMs(), () => {
    memoryQueues.delete(threadId);
    memoryQueueTimers.delete(threadId);
  });
};

const toQueuedPayload = (
  item: Omit<DingTalkQueuedMessage, 'queuedAt'> & { queuedAt?: number },
): DingTalkQueuedMessage => ({
  authorUserName: item.authorUserName,
  queuedAt: item.queuedAt ?? Date.now(),
  raw: item.raw,
  senderStaffId: item.senderStaffId,
  text: item.text,
  topicId: item.topicId,
});

const parseQueuedPayload = (raw: string): DingTalkQueuedMessage | null => {
  try {
    const parsed = JSON.parse(raw) as DingTalkQueuedMessage;
    if (!parsed || typeof parsed.text !== 'string') return null;
    return parsed;
  } catch (error) {
    log('parseQueuedPayload failed: %O', error);
    return null;
  }
};

/**
 * Atomically enqueue when there is room. RPUSH + LTRIM 0..(max-1) + EXPIRE
 * run inside one EVAL so two concurrent pushes cannot both observe length 4
 * and produce 6 items.
 */
const PUSH_SCRIPT = `
local len = redis.call('LLEN', KEYS[1])
if len >= tonumber(ARGV[2]) then
  return 0
end
redis.call('RPUSH', KEYS[1], ARGV[1])
redis.call('LTRIM', KEYS[1], 0, tonumber(ARGV[2]) - 1)
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
return 1
`;

/** Put an item back at the head, capped at max length. */
const UNSHIFT_SCRIPT = `
redis.call('LPUSH', KEYS[1], ARGV[1])
redis.call('LTRIM', KEYS[1], 0, tonumber(ARGV[2]) - 1)
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
return 1
`;

const pushMemoryQueue = (
  threadId: string,
  payload: DingTalkQueuedMessage,
): DingTalkQueuePushResult => {
  const list = memoryQueues.get(threadId) ?? [];
  if (list.length >= DINGTALK_QUEUE_MAX_LENGTH) return 'full';
  list.push(payload);
  memoryQueues.set(threadId, list);
  armMemoryQueue(threadId);
  return 'queued';
};

export const pushDingTalkQueuedMessage = async (
  threadId: string,
  item: Omit<DingTalkQueuedMessage, 'queuedAt'> & { queuedAt?: number },
): Promise<DingTalkQueuePushResult> => {
  const payload = toQueuedPayload(item);
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return pushMemoryQueue(threadId, payload);
  const key = queueKey(threadId);
  try {
    const queued = await redis.eval(
      PUSH_SCRIPT,
      1,
      key,
      JSON.stringify(payload),
      String(DINGTALK_QUEUE_MAX_LENGTH),
      String(DINGTALK_QUEUE_TTL_SECONDS),
    );
    return queued === 1 || queued === '1' ? 'queued' : 'full';
  } catch (error) {
    log('pushDingTalkQueuedMessage failed: %O', error);
    return 'unavailable';
  }
};

export const popDingTalkQueuedMessage = async (
  threadId: string,
): Promise<DingTalkQueuePopResult> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) {
    const list = memoryQueues.get(threadId);
    if (!list?.length) return { status: 'empty' };
    const next = list.shift();
    if (!next) return { status: 'empty' };
    if (list.length === 0) {
      memoryQueues.delete(threadId);
      clearTimer(memoryQueueTimers, threadId);
    } else {
      armMemoryQueue(threadId);
    }
    return { item: next, status: 'item' };
  }
  const key = queueKey(threadId);
  try {
    const raw = await redis.lpop(key);
    if (!raw) return { status: 'empty' };
    const item = parseQueuedPayload(raw);
    if (!item) return { status: 'invalid' };
    try {
      if ((await redis.llen(key)) > 0) {
        await redis.expire(key, DINGTALK_QUEUE_TTL_SECONDS);
      }
    } catch (error) {
      log('popDingTalkQueuedMessage: ttl refresh failed: %O', error);
    }
    return { item, status: 'item' };
  } catch (error) {
    log('popDingTalkQueuedMessage failed: %O', error);
    return { status: 'error' };
  }
};

/** Put a popped item back at the head (LPUSH + LTRIM) so drain can retry. */
export const unshiftDingTalkQueuedMessage = async (
  threadId: string,
  item: DingTalkQueuedMessage,
): Promise<boolean> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) {
    const list = memoryQueues.get(threadId) ?? [];
    list.unshift(item);
    if (list.length > DINGTALK_QUEUE_MAX_LENGTH) {
      list.length = DINGTALK_QUEUE_MAX_LENGTH;
    }
    memoryQueues.set(threadId, list);
    armMemoryQueue(threadId);
    return true;
  }
  try {
    await redis.eval(
      UNSHIFT_SCRIPT,
      1,
      queueKey(threadId),
      JSON.stringify(item),
      String(DINGTALK_QUEUE_MAX_LENGTH),
      String(DINGTALK_QUEUE_TTL_SECONDS),
    );
    return true;
  } catch (error) {
    log('unshiftDingTalkQueuedMessage failed: %O', error);
    return false;
  }
};

export const peekDingTalkQueueLength = async (threadId: string): Promise<number | null> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return memoryQueues.get(threadId)?.length ?? 0;
  try {
    return await redis.llen(queueKey(threadId));
  } catch (error) {
    log('peekDingTalkQueueLength failed: %O', error);
    return null;
  }
};

/** True when this process currently holds the busy flag (Redis or memory). */
export const isDingTalkBusyOwnedByThisProcess = (threadId: string): boolean => {
  pruneMemoryBusy(threadId);
  return processOwned.has(threadId) || memoryBusyExpiry.has(threadId);
};

/**
 * Atomic per-thread busy flag. SET NX with TTL, taken before dispatch so two
 * concurrent Chat-SDK handlers cannot both start a run. Process-local Map is
 * the fallback when Redis is not configured. TTL matches Redis (1 h) so a
 * crashed settle cannot pin the thread forever. A Redis SET throw is
 * `'unavailable'` — never treat a failed SET as acquired.
 */
export const tryAcquireDingTalkThreadBusy = async (
  threadId: string,
): Promise<DingTalkBusyClaim> => {
  pruneMemoryBusy(threadId);
  if (processOwned.has(threadId) || memoryBusyExpiry.has(threadId)) return 'busy';
  const redis = getAgentRuntimeRedisClient();
  if (!redis) {
    armMemoryBusy(threadId);
    return 'acquired';
  }
  try {
    const result = await redis.set(busyKey(threadId), '1', 'EX', DINGTALK_BUSY_TTL_SECONDS, 'NX');
    if (result === 'OK') {
      processOwned.add(threadId);
      armTimer(memoryBusyTimers, threadId, busyTtlMs(), () => {
        processOwned.delete(threadId);
        memoryBusyTimers.delete(threadId);
      });
      return 'acquired';
    }
    return 'busy';
  } catch (error) {
    log('tryAcquireDingTalkThreadBusy failed: %O', error);
    return 'unavailable';
  }
};

/**
 * Drain may run while this process already holds the flag. SET NX would
 * fail in that case and skip the overflow list. Re-enter without a second NX.
 */
export const acquireDingTalkDrainLock = async (threadId: string): Promise<DingTalkBusyClaim> => {
  pruneMemoryBusy(threadId);
  if (processOwned.has(threadId)) return 'acquired';
  return tryAcquireDingTalkThreadBusy(threadId);
};

export const releaseDingTalkThreadBusy = async (threadId: string): Promise<void> => {
  clearMemoryBusy(threadId);
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return;
  try {
    await redis.del(busyKey(threadId));
  } catch (error) {
    log('releaseDingTalkThreadBusy failed: %O', error);
  }
};

export const isDingTalkThreadBusy = async (threadId: string): Promise<boolean> => {
  pruneMemoryBusy(threadId);
  if (processOwned.has(threadId) || memoryBusyExpiry.has(threadId)) return true;
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return false;
  try {
    return (await redis.exists(busyKey(threadId))) === 1;
  } catch (error) {
    log('isDingTalkThreadBusy failed: %O', error);
    return false;
  }
};

/**
 * Drop queue keys that have no TTL (stale leftovers) or whose idle time
 * exceeds the 1 h contract. Called on worker/module start.
 */
export const dropStaleDingTalkQueues = async (): Promise<number> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return 0;
  const pattern = `${DINGTALK_QUEUE_KEY_PREFIX}*`;
  let cursor = '0';
  let dropped = 0;
  try {
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = next;
      for (const key of keys) {
        const ttl = await redis.ttl(key);
        // -1 = no expire (stale leftover). -2 = already gone.
        if (ttl === -1) {
          await redis.del(key);
          dropped += 1;
        }
      }
    } while (cursor !== '0');
  } catch (error) {
    log('dropStaleDingTalkQueues failed: %O', error);
  }
  return dropped;
};

type DrainHandler = (threadId: string) => Promise<void>;

let drainHandler: DrainHandler | undefined;

export const setDingTalkQueueDrainHandler = (handler: DrainHandler | undefined): void => {
  drainHandler = handler;
};

export const drainDingTalkQueue = async (threadId: string): Promise<void> => {
  if (!drainHandler) return;
  try {
    await drainHandler(threadId);
  } catch (error) {
    log('drainDingTalkQueue handler failed: %O', error);
  }
};

/** Test-only: drop process-local busy/queue state between cases. */
export const resetDingTalkQueueMemoryForTests = (): void => {
  processOwned.clear();
  memoryBusyExpiry.clear();
  memoryQueues.clear();
  for (const timer of memoryBusyTimers.values()) clearTimeout(timer);
  memoryBusyTimers.clear();
  for (const timer of memoryQueueTimers.values()) clearTimeout(timer);
  memoryQueueTimers.clear();
};
