import debug from 'debug';

import {
  formatYmdInTimeZone,
  IM_CONNECTOR_MESSAGES_COUNTER_KEY,
  IM_CONNECTOR_PUSHES_COUNTER_KEY,
  IM_CONNECTOR_STATS_TIMEZONE,
} from '@/server/enterprise/services/imConnectors/stats';
import { IM_CONNECTOR_STREAM_STATUS_KEY } from '@/server/enterprise/services/imConnectors/status';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

import { DINGTALK_COUNTER_TTL_SECONDS, DINGTALK_STREAM_STATUS_TTL_SECONDS } from './const';

const log = debug('lobe-server:messenger:dingtalk:redis');

export type DingTalkDailyCounterKind = 'messages' | 'pushes';

export interface DingTalkStreamStatusJson {
  connectedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  lastEventAt: string | null;
  pid: number | null;
  state: 'disabled' | 'connecting' | 'connected' | 'error';
  updatedAt: string;
}

const shanghaiYmd = (now = new Date()): string =>
  formatYmdInTimeZone(now, IM_CONNECTOR_STATS_TIMEZONE);

const counterKey = (kind: DingTalkDailyCounterKind, ymd: string): string =>
  kind === 'messages'
    ? IM_CONNECTOR_MESSAGES_COUNTER_KEY('dingtalk', ymd)
    : IM_CONNECTOR_PUSHES_COUNTER_KEY('dingtalk', ymd);

export const incrementDingTalkDailyCounter = async (
  kind: DingTalkDailyCounterKind,
  now = new Date(),
): Promise<void> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return;
  const key = counterKey(kind, shanghaiYmd(now));
  try {
    await redis.incr(key);
    await redis.expire(key, DINGTALK_COUNTER_TTL_SECONDS);
  } catch (error) {
    log('incrementDingTalkDailyCounter: %s failed: %O', kind, error);
  }
};

const chatDisabledNoticeKey = (staffId: string, ymd: string): string =>
  `messenger:dingtalk:chat-disabled-notice:${staffId}:${ymd}`;

/**
 * Returns true when this is the first chat-disabled notice for `staffId`
 * today (Asia/Shanghai), so the caller should send the notice.
 */
export const claimDingTalkChatDisabledNotice = async (
  staffId: string,
  now = new Date(),
): Promise<boolean> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return true;
  const key = chatDisabledNoticeKey(staffId, shanghaiYmd(now));
  try {
    const result = await redis.set(key, '1', 'EX', DINGTALK_COUNTER_TTL_SECONDS, 'NX');
    return result === 'OK';
  } catch (error) {
    log('claimDingTalkChatDisabledNotice failed: %O', error);
    return true;
  }
};

export const writeDingTalkStreamStatus = async (
  status: Omit<DingTalkStreamStatusJson, 'pid' | 'updatedAt'> & {
    pid?: number | null;
  },
): Promise<void> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return;
  const payload: DingTalkStreamStatusJson = {
    connectedAt: status.connectedAt,
    lastError: status.lastError,
    lastErrorAt: status.lastErrorAt,
    lastEventAt: status.lastEventAt,
    pid: status.pid ?? process.pid,
    state: status.state,
    updatedAt: new Date().toISOString(),
  };
  try {
    await redis.set(
      IM_CONNECTOR_STREAM_STATUS_KEY('dingtalk'),
      JSON.stringify(payload),
      'EX',
      DINGTALK_STREAM_STATUS_TTL_SECONDS,
    );
  } catch (error) {
    log('writeDingTalkStreamStatus failed: %O', error);
  }
};
