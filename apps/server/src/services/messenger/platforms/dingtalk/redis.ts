import debug from 'debug';

import {
  formatYmdInTimeZone,
  IM_CONNECTOR_MESSAGES_COUNTER_KEY,
  IM_CONNECTOR_PUSHES_COUNTER_KEY,
  IM_CONNECTOR_STATS_TIMEZONE,
} from '@/server/enterprise/services/imConnectors/stats';
import { IM_CONNECTOR_STREAM_STATUS_KEY } from '@/server/enterprise/services/imConnectors/status';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

import type { DingTalkLastListKind } from './const';
import {
  DINGTALK_CORP_ID_KEY,
  DINGTALK_COUNTER_TTL_SECONDS,
  DINGTALK_LAST_LIST_KEY_PREFIX,
  DINGTALK_LAST_LIST_TTL_SECONDS,
  DINGTALK_STREAM_STATUS_TTL_SECONDS,
} from './const';

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

const LAST_LIST_KINDS = new Set<DingTalkLastListKind>(['agents', 'question', 'topics']);

const lastListKey = (threadId: string): string => `${DINGTALK_LAST_LIST_KEY_PREFIX}${threadId}`;

const lastListMemory = new Map<string, { expiresAt: number; kind: DingTalkLastListKind }>();

const isLastListKind = (value: string | null | undefined): value is DingTalkLastListKind =>
  value === 'agents' || value === 'question' || value === 'topics';

const writeLastListMemory = (key: string, kind: DingTalkLastListKind): void => {
  lastListMemory.set(key, {
    expiresAt: Date.now() + DINGTALK_LAST_LIST_TTL_SECONDS * 1000,
    kind,
  });
};

const consumeLastListMemory = (key: string): DingTalkLastListKind | null => {
  const stored = lastListMemory.get(key);
  lastListMemory.delete(key);
  if (!stored) return null;
  if (stored.expiresAt <= Date.now()) return null;
  return stored.kind;
};

export const setDingTalkLastList = async (
  threadId: string,
  kind: DingTalkLastListKind,
): Promise<void> => {
  if (!LAST_LIST_KINDS.has(kind) || !threadId) return;
  const key = lastListKey(threadId);
  const redis = getAgentRuntimeRedisClient();
  if (!redis) {
    writeLastListMemory(key, kind);
    return;
  }
  try {
    await redis.set(key, kind, 'EX', DINGTALK_LAST_LIST_TTL_SECONDS);
  } catch (error) {
    log('setDingTalkLastList failed: %O', error);
    writeLastListMemory(key, kind);
  }
};

/**
 * Read-and-clear the last agents/topics/question list for this thread.
 * Missing key or expired memory entry → `null` (a bare number then goes to the agent).
 */
export const consumeDingTalkLastList = async (
  threadId: string,
): Promise<DingTalkLastListKind | null> => {
  if (!threadId) return null;
  const key = lastListKey(threadId);
  const redis = getAgentRuntimeRedisClient();
  if (redis) {
    try {
      const value = await redis.get(key);
      if (value) await redis.del(key);
      if (isLastListKind(value)) return value;
    } catch (error) {
      log('consumeDingTalkLastList failed: %O', error);
    }
  }
  return consumeLastListMemory(key);
};

/**
 * Persist the corpId captured from inbound robot messages. No TTL — the SSO
 * bridge reads this when the connector settings omit `corpId`.
 */
export const rememberDingTalkCorpId = async (corpId: string | undefined | null): Promise<void> => {
  const value = corpId?.trim();
  if (!value) return;
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return;
  try {
    const existing = await redis.get(DINGTALK_CORP_ID_KEY);
    if (existing === value) return;
    await redis.set(DINGTALK_CORP_ID_KEY, value);
  } catch (error) {
    log('rememberDingTalkCorpId failed: %O', error);
  }
};
