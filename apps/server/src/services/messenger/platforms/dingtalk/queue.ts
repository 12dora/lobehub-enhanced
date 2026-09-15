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

const queueKey = (threadId: string): string => `${DINGTALK_QUEUE_KEY_PREFIX}${threadId}`;

const busyKey = (threadId: string): string => `${DINGTALK_BUSY_KEY_PREFIX}${threadId}`;

const memoryBusy = new Set<string>();

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

export const pushDingTalkQueuedMessage = async (
  threadId: string,
  item: Omit<DingTalkQueuedMessage, 'queuedAt'> & { queuedAt?: number },
): Promise<DingTalkQueuePushResult> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return 'unavailable';
  const key = queueKey(threadId);
  const payload: DingTalkQueuedMessage = {
    authorUserName: item.authorUserName,
    queuedAt: item.queuedAt ?? Date.now(),
    raw: item.raw,
    senderStaffId: item.senderStaffId,
    text: item.text,
    topicId: item.topicId,
  };
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
): Promise<DingTalkQueuedMessage | null> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return null;
  const key = queueKey(threadId);
  try {
    const raw = await redis.lpop(key);
    if (!raw) return null;
    if ((await redis.llen(key)) > 0) {
      await redis.expire(key, DINGTALK_QUEUE_TTL_SECONDS);
    }
    const parsed = JSON.parse(raw) as DingTalkQueuedMessage;
    if (!parsed || typeof parsed.text !== 'string') return null;
    return parsed;
  } catch (error) {
    log('popDingTalkQueuedMessage failed: %O', error);
    return null;
  }
};

export const peekDingTalkQueueLength = async (threadId: string): Promise<number> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return 0;
  try {
    return await redis.llen(queueKey(threadId));
  } catch (error) {
    log('peekDingTalkQueueLength failed: %O', error);
    return 0;
  }
};

/**
 * Atomic per-thread busy flag. SET NX with TTL, taken before dispatch so two
 * concurrent Chat-SDK handlers cannot both start a run. Process-local Set is
 * the fallback when Redis is not configured.
 */
export const tryAcquireDingTalkThreadBusy = async (
  threadId: string,
): Promise<DingTalkBusyClaim> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) {
    if (memoryBusy.has(threadId)) return 'busy';
    memoryBusy.add(threadId);
    return 'acquired';
  }
  try {
    const result = await redis.set(busyKey(threadId), '1', 'EX', DINGTALK_BUSY_TTL_SECONDS, 'NX');
    return result === 'OK' ? 'acquired' : 'busy';
  } catch (error) {
    log('tryAcquireDingTalkThreadBusy failed: %O', error);
    return 'unavailable';
  }
};

export const releaseDingTalkThreadBusy = async (threadId: string): Promise<void> => {
  memoryBusy.delete(threadId);
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return;
  try {
    await redis.del(busyKey(threadId));
  } catch (error) {
    log('releaseDingTalkThreadBusy failed: %O', error);
  }
};

export const isDingTalkThreadBusy = async (threadId: string): Promise<boolean> => {
  if (memoryBusy.has(threadId)) return true;
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
