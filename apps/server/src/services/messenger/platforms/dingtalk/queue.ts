import debug from 'debug';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

import {
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

const queueKey = (threadId: string): string => `${DINGTALK_QUEUE_KEY_PREFIX}${threadId}`;

export const pushDingTalkQueuedMessage = async (
  threadId: string,
  item: Omit<DingTalkQueuedMessage, 'queuedAt'> & { queuedAt?: number },
): Promise<DingTalkQueuePushResult> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return 'unavailable';
  const key = queueKey(threadId);
  try {
    const length = await redis.llen(key);
    if (length >= DINGTALK_QUEUE_MAX_LENGTH) return 'full';
    const payload: DingTalkQueuedMessage = {
      authorUserName: item.authorUserName,
      queuedAt: item.queuedAt ?? Date.now(),
      raw: item.raw,
      senderStaffId: item.senderStaffId,
      text: item.text,
      topicId: item.topicId,
    };
    await redis.rpush(key, JSON.stringify(payload));
    await redis.expire(key, DINGTALK_QUEUE_TTL_SECONDS);
    return 'queued';
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
