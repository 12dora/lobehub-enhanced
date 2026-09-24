import { getDingtalkPersonalRedis } from './cache';
import { DingtalkPersonalError } from './errors';

export const DINGTALK_PERSONAL_RATE_LIMIT = 60;
export const DINGTALK_PERSONAL_RATE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Fixed window, 60 calls / 5 minutes per user.
 * Redis down or absent fails open so a cache outage does not block reads.
 */
export const assertDingtalkPersonalRateLimit = async (
  userId: string,
  now = Date.now(),
): Promise<void> => {
  const redis = getDingtalkPersonalRedis();
  if (!redis) return;

  const windowId = Math.floor(now / DINGTALK_PERSONAL_RATE_WINDOW_MS);
  const key = `dingtalk-personal:rl:${userId}:${windowId}`;
  try {
    const used = await redis.incr(key);
    if (used === 1) {
      await redis.expire(key, Math.ceil(DINGTALK_PERSONAL_RATE_WINDOW_MS / 1000));
    }
    if (used > DINGTALK_PERSONAL_RATE_LIMIT) {
      throw new DingtalkPersonalError('DINGTALK_PERSONAL_RATE_LIMITED');
    }
  } catch (error) {
    if (error instanceof DingtalkPersonalError) throw error;
  }
};
